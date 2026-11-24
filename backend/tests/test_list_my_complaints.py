import base64
import json
import unittest

from backend.auth import ForbiddenError
from backend.complaints import list_my_complaints
from backend.errors import ValidationError


class FakeTable:
    def __init__(self, response=None):
        self.response = response or {"Items": []}
        self.query_calls = []

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.response


class ListMyComplaintsTests(unittest.TestCase):
    def setUp(self):
        self.claims = {"sub": "verified-student-sub", "cognito:groups": []}
        self.item = {
            "complaintId": "CC-20261124-0123456789ABCDEF0123456789ABCDEF",
            "studentId": "verified-student-sub",
            "recordType": "COMPLAINT",
            "title": "Library Wi-Fi keeps disconnecting",
            "status": "Pending",
            "createdAt": "2026-11-24T10:00:00.000Z",
            "updatedAt": "2026-11-24T10:00:00.000Z",
            "history": [],
        }

    def test_queries_only_authenticated_students_index_partition(self):
        table = FakeTable({"Items": [self.item]})
        result = list_my_complaints(self.claims, {"limit": "10"}, table)
        request = table.query_calls[0]
        expression = request["KeyConditionExpression"].get_expression()
        self.assertEqual(request["IndexName"], "StudentCreatedIndex")
        self.assertEqual(expression["values"][1], "verified-student-sub")
        self.assertEqual(request["Limit"], 10)
        self.assertFalse(request["ScanIndexForward"])
        self.assertEqual(result["items"][0]["ownerId"], "verified-student-sub")
        self.assertIsNone(result["nextToken"])

    def test_cursor_is_scoped_to_the_verified_student(self):
        last_key = {
            "complaintId": self.item["complaintId"],
            "studentId": "verified-student-sub",
            "createdAt": self.item["createdAt"],
        }
        token = base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode().rstrip("=")
        table = FakeTable()
        list_my_complaints(self.claims, {"nextToken": token}, table)
        self.assertEqual(table.query_calls[0]["ExclusiveStartKey"], last_key)

    def test_rejects_cursor_from_another_student(self):
        last_key = {
            "complaintId": self.item["complaintId"],
            "studentId": "another-student",
            "createdAt": self.item["createdAt"],
        }
        token = base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode().rstrip("=")
        table = FakeTable()
        with self.assertRaises(ValidationError):
            list_my_complaints(self.claims, {"nextToken": token}, table)
        self.assertEqual(table.query_calls, [])

    def test_rejects_invalid_page_size_and_admin_access(self):
        with self.assertRaises(ValidationError):
            list_my_complaints(self.claims, {"limit": "1000"}, FakeTable())
        with self.assertRaises(ForbiddenError):
            list_my_complaints(
                {**self.claims, "cognito:groups": ["CampusCareAdmins"]},
                {},
                FakeTable(),
            )


if __name__ == "__main__":
    unittest.main()
