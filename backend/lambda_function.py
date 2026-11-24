import base64
import binascii
import json
import logging
import re

from botocore.exceptions import BotoCoreError, ClientError

from .auth import (
    AuthConfigurationError,
    AuthServiceUnavailableError,
    ForbiddenError,
    UnauthorizedError,
    get_bearer_token,
    require_admin,
    user_role,
    verify_access_token,
)
from .complaints import (
    create_complaint,
    get_admin_stats,
    get_complaint,
    get_my_stats,
    list_admin_complaints,
    list_my_complaints,
    update_admin_complaint,
)
from .errors import ApiError, ConfigurationError, ValidationError
from .storage import get_table


logger = logging.getLogger(__name__)
COMPLAINT_PATH_PATTERN = re.compile(r"^/complaints/([^/]+)$")
ADMIN_COMPLAINT_PATH_PATTERN = re.compile(r"^/admin/complaints/([^/]+)$")


def _response(status_code, payload=None):
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": "" if payload is None else json.dumps(payload),
    }


def _request_parts(event):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = http.get("method") or event.get("httpMethod") or ""
    path = http.get("path") or event.get("rawPath") or event.get("path") or "/"
    headers = event.get("headers") or {}
    return method.upper(), path, headers


def _claims_from_event(headers):
    return verify_access_token(get_bearer_token(headers))


def _query_params(event):
    values = event.get("queryStringParameters")
    if values is None:
        return {}
    if not isinstance(values, dict):
        raise ValidationError("Query parameters are invalid.")
    return values


def _json_body(event):
    body = event.get("body")
    if not isinstance(body, str) or not body:
        raise ValidationError("A JSON request body is required.")
    try:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body, validate=True).decode("utf-8")
        payload = json.loads(body)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        raise ValidationError("The request body must contain valid JSON.") from None
    if not isinstance(payload, dict):
        raise ValidationError("The request body must be a JSON object.")
    return payload


def _dynamodb_failure(error):
    code = error.response.get("Error", {}).get("Code", "Unknown")
    if code in {
        "ProvisionedThroughputExceededException",
        "RequestLimitExceeded",
        "ThrottlingException",
        "InternalServerError",
        "ServiceUnavailable",
    }:
        logger.warning("DynamoDB temporarily unavailable: %s", code)
        return _response(503, {"message": "The complaint service is temporarily unavailable."})
    logger.exception("DynamoDB request failed with code %s", code)
    return _response(500, {"message": "The complaint service could not complete the request."})


def lambda_handler(event, context):
    method, path, headers = _request_parts(event)

    if method == "OPTIONS":
        return _response(204)
    if method == "GET" and path == "/health":
        return _response(200, {"ok": True})

    try:
        if method == "GET" and path == "/auth/me":
            claims = _claims_from_event(headers)
            groups = claims.get("cognito:groups", [])
            if not isinstance(groups, list):
                groups = []
            return _response(200, {
                "sub": claims["sub"],
                "username": claims.get("username", ""),
                "groups": groups,
                "role": user_role(claims),
            })

        if method == "GET" and path == "/admin/check":
            claims = _claims_from_event(headers)
            require_admin(claims)
            return _response(200, {"ok": True, "sub": claims["sub"], "role": "admin"})

        if path == "/complaints" and method == "POST":
            claims = _claims_from_event(headers)
            complaint = create_complaint(claims, _json_body(event), get_table())
            return _response(201, complaint)

        if path == "/complaints/my" and method == "GET":
            claims = _claims_from_event(headers)
            complaints = list_my_complaints(claims, _query_params(event), get_table())
            return _response(200, complaints)

        if path == "/complaints/my/stats" and method == "GET":
            claims = _claims_from_event(headers)
            return _response(200, get_my_stats(claims, get_table()))

        match = COMPLAINT_PATH_PATTERN.fullmatch(path)
        if match and method == "GET":
            claims = _claims_from_event(headers)
            complaint = get_complaint(claims, match.group(1), get_table())
            return _response(200, complaint)

        if path == "/admin/complaints" and method == "GET":
            claims = _claims_from_event(headers)
            require_admin(claims)
            complaints = list_admin_complaints(claims, _query_params(event), get_table())
            return _response(200, complaints)

        if path == "/admin/stats" and method == "GET":
            claims = _claims_from_event(headers)
            require_admin(claims)
            return _response(200, get_admin_stats(claims, get_table()))

        match = ADMIN_COMPLAINT_PATH_PATTERN.fullmatch(path)
        if match and method == "PATCH":
            claims = _claims_from_event(headers)
            require_admin(claims)
            complaint = update_admin_complaint(
                claims,
                match.group(1),
                _json_body(event),
                get_table(),
            )
            return _response(200, complaint)

        return _response(404, {"message": "Route not found."})
    except (UnauthorizedError, ForbiddenError) as error:
        return _response(401 if isinstance(error, UnauthorizedError) else 403, {"message": str(error)})
    except AuthServiceUnavailableError as error:
        return _response(503, {"message": str(error)})
    except (AuthConfigurationError, ConfigurationError) as error:
        logger.error("Application configuration error: %s", error)
        return _response(500, {"message": "The application is not configured correctly."})
    except ApiError as error:
        return _response(error.status_code, {"message": error.message})
    except ClientError as error:
        return _dynamodb_failure(error)
    except BotoCoreError:
        logger.exception("DynamoDB transport error")
        return _response(503, {"message": "The complaint service is temporarily unavailable."})
