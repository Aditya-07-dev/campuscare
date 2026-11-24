import base64
import binascii
import json
import re
import uuid
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from .auth import ForbiddenError, require_admin, user_role
from .errors import ConflictError, NotFoundError, ValidationError


COMPLAINT_CATEGORIES = {
    "Facilities",
    "IT & Wi-Fi",
    "Academics",
    "Cleanliness",
    "Safety",
    "Other",
}
COMPLAINT_LOCATIONS = {
    "Central Library",
    "Main Block",
    "Hostel",
    "Cafeteria",
    "Engineering Lab",
    "Sports Complex",
    "Other",
}
PRIORITIES = {"Low", "Medium", "High"}
COMPLAINT_ID_PATTERN = re.compile(r"^CC-\d{8}-[0-9A-F]{32}$")
MAX_DESCRIPTION_LENGTH = 2000
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50
COMPLAINT_STATUSES = {"Pending", "In Progress", "Resolved"}
ALLOWED_STATUS_TRANSITIONS = {
    "Pending": {"In Progress"},
    "In Progress": {"Resolved"},
    "Resolved": set(),
}


def _validate_text(value, field, minimum, maximum, multiline=False):
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text.")
    value = value.strip()
    if not minimum <= len(value) <= maximum:
        raise ValidationError(f"{field} must be between {minimum} and {maximum} characters.")
    allowed_controls = {"\n", "\r", "\t"} if multiline else set()
    if any(ord(char) < 32 and char not in allowed_controls for char in value):
        raise ValidationError(f"{field} contains unsupported control characters.")
    return value


def _validate_choice(value, field, options, message):
    if not isinstance(value, str) or value not in options:
        raise ValidationError(message)
    return value


def validate_create_payload(payload):
    if not isinstance(payload, dict):
        raise ValidationError("The request body must be a JSON object.")

    allowed_fields = {"title", "category", "location", "priority", "description"}
    unknown_fields = set(payload) - allowed_fields
    missing_fields = allowed_fields - set(payload)
    if unknown_fields:
        raise ValidationError(f"Unsupported field(s): {', '.join(sorted(unknown_fields))}.")
    if missing_fields:
        raise ValidationError(f"Missing field(s): {', '.join(sorted(missing_fields))}.")

    title = _validate_text(payload["title"], "title", 3, 100)
    description = _validate_text(
        payload["description"],
        "description",
        20,
        MAX_DESCRIPTION_LENGTH,
        multiline=True,
    )
    category = _validate_choice(payload["category"], "category", COMPLAINT_CATEGORIES, "category is not supported.")
    location = _validate_choice(payload["location"], "location", COMPLAINT_LOCATIONS, "location is not supported.")
    priority = _validate_choice(
        payload["priority"],
        "priority",
        PRIORITIES,
        "priority must be Low, Medium, or High.",
    )

    return {
        "title": title,
        "category": category,
        "location": location,
        "priority": priority,
        "description": description,
    }


def serialize_complaint(item):
    result = dict(item)
    result["id"] = item["complaintId"]
    result["ownerId"] = item["studentId"]
    result["ownerName"] = item.get("studentName", "")
    result["ownerEmail"] = item.get("studentEmail", "")
    result["adminRemark"] = item.get("adminRemark", "")
    return result


def _validate_page_options(query_params, allowed_fields):
    if not isinstance(query_params, dict):
        raise ValidationError("Query parameters are invalid.")
    unknown_fields = set(query_params) - allowed_fields
    if unknown_fields:
        raise ValidationError(f"Unsupported query parameter(s): {', '.join(sorted(unknown_fields))}.")

    raw_limit = query_params.get("limit")
    if raw_limit is None:
        limit = DEFAULT_PAGE_SIZE
    elif not isinstance(raw_limit, str) or not re.fullmatch(r"[0-9]{1,2}", raw_limit):
        raise ValidationError("limit must be an integer from 1 to 50.")
    else:
        limit = int(raw_limit)
        if not 1 <= limit <= MAX_PAGE_SIZE:
            raise ValidationError("limit must be an integer from 1 to 50.")

    return limit


def _encode_cursor(last_key):
    serialized = json.dumps(last_key, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(serialized).decode("ascii").rstrip("=")


def _decode_cursor(token, partition_name, partition_value):
    if not isinstance(token, str) or not 1 <= len(token) <= 4096 or not re.fullmatch(r"[A-Za-z0-9_-]+", token):
        raise ValidationError("nextToken is invalid.")
    try:
        padded = token + "=" * ((4 - len(token) % 4) % 4)
        payload = base64.b64decode(padded, altchars=b"-_", validate=True)
        last_key = json.loads(payload.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        raise ValidationError("nextToken is invalid.") from None

    required_keys = {"complaintId", partition_name, "createdAt"}
    if not isinstance(last_key, dict) or set(last_key) != required_keys:
        raise ValidationError("nextToken is invalid.")
    if not all(isinstance(value, str) for value in last_key.values()):
        raise ValidationError("nextToken is invalid.")
    if last_key[partition_name] != partition_value:
        raise ValidationError("nextToken does not belong to this complaint query.")
    if not COMPLAINT_ID_PATTERN.fullmatch(last_key["complaintId"]):
        raise ValidationError("nextToken is invalid.")
    try:
        datetime.fromisoformat(last_key["createdAt"].replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError("nextToken is invalid.") from None
    return last_key


def create_complaint(claims, payload, table):
    if user_role(claims) != "student":
        raise ForbiddenError("Only student accounts can submit complaints.")
    student_id = claims["sub"]
    if not isinstance(student_id, str) or not student_id:
        raise ValidationError("The authenticated student identity is invalid.")

    values = validate_create_payload(payload)
    created_at = datetime.now(timezone.utc)
    now = created_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    complaint_id = f"CC-{created_at:%Y%m%d}-{uuid.uuid4().hex.upper()}"
    item = {
        "complaintId": complaint_id,
        "recordType": "COMPLAINT",
        "studentId": student_id,
        "studentName": str(claims.get("name") or claims.get("username") or ""),
        "studentEmail": str(claims.get("email") or ""),
        **values,
        "status": "Pending",
        "adminRemark": "",
        "createdAt": now,
        "updatedAt": now,
        "history": [{"status": "Pending", "at": now, "note": "Complaint submitted"}],
    }
    table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(#complaintId)",
        ExpressionAttributeNames={"#complaintId": "complaintId"},
    )
    return serialize_complaint(item)


def get_complaint(claims, complaint_id, table):
    if not isinstance(complaint_id, str) or not COMPLAINT_ID_PATTERN.fullmatch(complaint_id):
        raise ValidationError("complaintId is invalid.")

    result = table.get_item(Key={"complaintId": complaint_id}, ConsistentRead=True)
    item = result.get("Item")
    if not item:
        raise NotFoundError("Complaint was not found.")
    if user_role(claims) != "admin" and item.get("studentId") != claims["sub"]:
        raise ForbiddenError("You cannot view this complaint.")
    return serialize_complaint(item)


def list_my_complaints(claims, query_params, table):
    if user_role(claims) != "student":
        raise ForbiddenError("Only student accounts can view their complaint history.")
    student_id = claims["sub"]
    limit = _validate_page_options(query_params, {"limit", "nextToken"})
    query = {
        "IndexName": "StudentCreatedIndex",
        "KeyConditionExpression": Key("studentId").eq(student_id),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if "nextToken" in query_params:
        query["ExclusiveStartKey"] = _decode_cursor(
            query_params["nextToken"],
            "studentId",
            student_id,
        )

    result = table.query(**query)
    items = [serialize_complaint(item) for item in result.get("Items", [])]
    last_key = result.get("LastEvaluatedKey")
    return {
        "items": items,
        "nextToken": _encode_cursor(last_key) if last_key else None,
    }


def get_my_stats(claims, table):
    if user_role(claims) != "student":
        raise ForbiddenError("Only student accounts can view their complaint statistics.")
    student_id = claims["sub"]
    stats = {
        "totalComplaints": 0,
        "pendingComplaints": 0,
        "inProgressComplaints": 0,
        "resolvedComplaints": 0,
        "recentComplaints": [],
    }
    last_key = None
    while True:
        query = {
            "IndexName": "StudentCreatedIndex",
            "KeyConditionExpression": Key("studentId").eq(student_id),
            "ProjectionExpression": (
                "#complaintId, #studentId, #createdAt, #title, #category, "
                "#location, #priority, #status"
            ),
            "ExpressionAttributeNames": {
                "#complaintId": "complaintId",
                "#studentId": "studentId",
                "#createdAt": "createdAt",
                "#title": "title",
                "#category": "category",
                "#location": "location",
                "#priority": "priority",
                "#status": "status",
            },
            "ScanIndexForward": False,
        }
        if last_key:
            query["ExclusiveStartKey"] = last_key
        result = table.query(**query)
        items = result.get("Items", [])
        if len(stats["recentComplaints"]) < 4:
            stats["recentComplaints"].extend(items[:4 - len(stats["recentComplaints"])])
        for item in items:
            stats["totalComplaints"] += 1
            status_counter = {
                "Pending": "pendingComplaints",
                "In Progress": "inProgressComplaints",
                "Resolved": "resolvedComplaints",
            }.get(item.get("status"))
            if status_counter:
                stats[status_counter] += 1
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            stats["recentComplaints"] = [
                serialize_complaint(item) for item in stats["recentComplaints"]
            ]
            return stats


def list_admin_complaints(claims, query_params, table):
    require_admin(claims)
    allowed_fields = {"limit", "nextToken", "category", "priority", "status", "q"}
    limit = _validate_page_options(query_params, allowed_fields)

    filters = []
    for field, options in (
        ("category", COMPLAINT_CATEGORIES),
        ("priority", PRIORITIES),
        ("status", COMPLAINT_STATUSES),
    ):
        value = query_params.get(field)
        if value is not None:
            if not isinstance(value, str) or value not in options:
                raise ValidationError(f"{field} is not supported.")
            filters.append(Attr(field).eq(value))

    search = query_params.get("q")
    if search is not None:
        search = _validate_text(search, "q", 1, 100)
        filters.append(Attr("title").contains(search))

    query = {
        "IndexName": "AdminCreatedIndex",
        "KeyConditionExpression": Key("recordType").eq("COMPLAINT"),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if filters:
        filter_expression = filters[0]
        for condition in filters[1:]:
            filter_expression = filter_expression & condition
        query["FilterExpression"] = filter_expression
    if "nextToken" in query_params:
        query["ExclusiveStartKey"] = _decode_cursor(
            query_params["nextToken"],
            "recordType",
            "COMPLAINT",
        )

    result = table.query(**query)
    items = [serialize_complaint(item) for item in result.get("Items", [])]
    last_key = result.get("LastEvaluatedKey")
    return {
        "items": items,
        "nextToken": _encode_cursor(last_key) if last_key else None,
    }


def update_admin_complaint(claims, complaint_id, payload, table):
    require_admin(claims)
    if not isinstance(complaint_id, str) or not COMPLAINT_ID_PATTERN.fullmatch(complaint_id):
        raise ValidationError("complaintId is invalid.")
    if not isinstance(payload, dict):
        raise ValidationError("The request body must be a JSON object.")

    allowed_fields = {"status", "adminRemark"}
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        raise ValidationError(f"Unsupported field(s): {', '.join(sorted(unknown_fields))}.")
    if not payload:
        raise ValidationError("At least one update field is required.")

    requested_status = payload.get("status")
    if "status" in payload and (
        not isinstance(requested_status, str) or requested_status not in COMPLAINT_STATUSES
    ):
        raise ValidationError("status is not supported.")
    requested_remark = None
    if "adminRemark" in payload:
        requested_remark = _validate_text(payload["adminRemark"], "adminRemark", 1, 1000, multiline=True)

    result = table.get_item(Key={"complaintId": complaint_id}, ConsistentRead=True)
    item = result.get("Item")
    if not item:
        raise NotFoundError("Complaint was not found.")

    current_status = item.get("status")
    if current_status not in COMPLAINT_STATUSES:
        raise ConflictError("The complaint has an unsupported current status.")
    updated_status = requested_status if requested_status is not None else current_status
    if updated_status != current_status and updated_status not in ALLOWED_STATUS_TRANSITIONS[current_status]:
        raise ConflictError(f"Status cannot transition from {current_status} to {updated_status}.")

    current_remark = item.get("adminRemark", "")
    updated_remark = requested_remark if requested_remark is not None else current_remark
    if updated_status == "Resolved" and not requested_remark:
        raise ValidationError("A resolution remark is required when resolving a complaint.")
    if updated_status == current_status and updated_remark == current_remark:
        raise ValidationError("The update does not change the complaint.")

    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    history_entry = {
        "status": updated_status,
        "at": now,
        "note": updated_remark or "Status updated by administrator",
        "adminId": claims["sub"],
    }
    try:
        result = table.update_item(
            Key={"complaintId": complaint_id},
            UpdateExpression=(
                "SET #status = :status, #adminRemark = :remark, #updatedAt = :updatedAt, "
                "#history = list_append(if_not_exists(#history, :empty), :entry)"
            ),
            ConditionExpression=(
                "#status = :currentStatus AND #updatedAt = :currentUpdatedAt "
                "AND #adminRemark = :currentRemark"
            ),
            ExpressionAttributeNames={
                "#status": "status",
                "#adminRemark": "adminRemark",
                "#updatedAt": "updatedAt",
                "#history": "history",
            },
            ExpressionAttributeValues={
                ":status": updated_status,
                ":remark": updated_remark,
                ":updatedAt": now,
                ":empty": [],
                ":entry": [history_entry],
                ":currentStatus": current_status,
                ":currentUpdatedAt": item["updatedAt"],
                ":currentRemark": current_remark,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise ConflictError("The complaint changed during this update. Reload it and try again.") from error
        raise

    return serialize_complaint(result["Attributes"])


def get_admin_stats(claims, table):
    require_admin(claims)
    stats = {
        "totalComplaints": 0,
        "pendingComplaints": 0,
        "inProgressComplaints": 0,
        "resolvedComplaints": 0,
        "categories": {category: 0 for category in sorted(COMPLAINT_CATEGORIES)},
    }
    last_key = None
    while True:
        query = {
            "IndexName": "AdminCreatedIndex",
            "KeyConditionExpression": Key("recordType").eq("COMPLAINT"),
            "ProjectionExpression": "#status, #category",
            "ExpressionAttributeNames": {
                "#status": "status",
                "#category": "category",
            },
            "ScanIndexForward": False,
        }
        if last_key:
            query["ExclusiveStartKey"] = last_key
        result = table.query(**query)
        for item in result.get("Items", []):
            stats["totalComplaints"] += 1
            status_counter = {
                "Pending": "pendingComplaints",
                "In Progress": "inProgressComplaints",
                "Resolved": "resolvedComplaints",
            }.get(item.get("status"))
            if status_counter:
                stats[status_counter] += 1
            category = item.get("category")
            if category in stats["categories"]:
                stats["categories"][category] += 1
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            return stats
