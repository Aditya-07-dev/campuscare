import base64
import json
import unittest

from backend.auth import ForbiddenError
from backend.complaints import list_admin_complaints
from backend.errors import ValidationError


class FakeTable:
    def __init__(self, response=None):
        self.response = response or {"Items": []}
        self.query_calls = []

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.response


class ListAdminComplaintsTests(unittest.TestCase):
    def setUp(self):
        self.claims = {"sub": "verified-admin-sub", "cognito:groups": ["CampusCareAdmins"]}
        self.item = {
            "complaintId": "CC-20261124-0123456789ABCDEF0123456789ABCDEF",
            "recordType": "COMPLAINT",
            "studentId": "student-sub",
            "title": "Library Wi-Fi keeps disconnecting",
            "category": "IT & Wi-Fi",
            "priority": "High",
            "status": "Pending",
            "createdAt": "2026-11-24T10:00:00.000Z",
            "updatedAt": "2026-11-24T10:00:00.000Z",
        }

    def test_queries_admin_index_with_validated_filters(self):
        table = FakeTable({"Items": [self.item]})
        result = list_admin_complaints(
            self.claims,
            {"limit": "10", "category": "IT & Wi-Fi", "priority": "High", "status": "Pending", "q": "Wi-Fi"},
            table,
        )
        request = table.query_calls[0]
        self.assertEqual(request["IndexName"], "AdminCreatedIndex")
        self.assertEqual(request["Limit"], 10)
        self.assertEqual(request["KeyConditionExpression"].get_expression()["values"][1], "COMPLAINT")
        self.assertIn("FilterExpression", request)
        self.assertEqual(result["items"][0]["complaintId"], self.item["complaintId"])

    def test_returns_cursor_from_index_query(self):
        last_key = {
            "complaintId": self.item["complaintId"],
            "recordType": "COMPLAINT",
            "createdAt": self.item["createdAt"],
        }
        table = FakeTable({"Items": [], "LastEvaluatedKey": last_key})
        result = list_admin_complaints(self.claims, {}, table)
        decoded = base64.urlsafe_b64decode(result["nextToken"] + "==").decode()
        self.assertEqual(json.loads(decoded), last_key)

    def test_rejects_non_admin_and_invalid_filters_without_querying(self):
        table = FakeTable()
        with self.assertRaises(ForbiddenError):
            list_admin_complaints({"sub": "student-sub", "cognito:groups": []}, {}, table)
        with self.assertRaises(ValidationError):
            list_admin_complaints(self.claims, {"status": "Closed"}, table)
        with self.assertRaises(ValidationError):
            list_admin_complaints(self.claims, {"unexpected": "value"}, table)
        self.assertEqual(table.query_calls, [])


if __name__ == "__main__":
    unittest.main()
