import re
import unittest

from backend.auth import ForbiddenError
from backend.complaints import create_complaint, validate_create_payload
from backend.errors import ValidationError


class FakeTable:
    def __init__(self):
        self.put_calls = []

    def put_item(self, **kwargs):
        self.put_calls.append(kwargs)


class CreateComplaintTests(unittest.TestCase):
    def setUp(self):
        self.table = FakeTable()
        self.claims = {
            "sub": "verified-student-sub",
            "username": "student@example.edu",
            "cognito:groups": [],
        }
        self.payload = {
            "title": "Library Wi-Fi keeps disconnecting",
            "category": "IT & Wi-Fi",
            "location": "Central Library",
            "priority": "High",
            "description": "The connection drops every few minutes on the second floor.",
        }

    def test_creates_pending_complaint_for_token_subject(self):
        result = create_complaint(self.claims, self.payload, self.table)
        item = self.table.put_calls[0]["Item"]
        self.assertRegex(result["complaintId"], re.compile(r"^CC-\d{8}-[0-9A-F]{32}$"))
        self.assertEqual(item["studentId"], "verified-student-sub")
        self.assertEqual(item["status"], "Pending")
        self.assertEqual(item["history"][0]["status"], "Pending")
        self.assertEqual(item["createdAt"], item["updatedAt"])
        self.assertEqual(result["ownerId"], "verified-student-sub")
        self.assertEqual(
            self.table.put_calls[0]["ConditionExpression"],
            "attribute_not_exists(#complaintId)",
        )

    def test_rejects_client_supplied_identity_or_role(self):
        with self.assertRaises(ValidationError):
            create_complaint(
                self.claims,
                {**self.payload, "studentId": "someone-else", "role": "admin"},
                self.table,
            )
        self.assertEqual(self.table.put_calls, [])

    def test_admin_cannot_submit_as_a_student(self):
        with self.assertRaises(ForbiddenError):
            create_complaint(
                {**self.claims, "cognito:groups": ["CampusCareAdmins"]},
                self.payload,
                self.table,
            )
        self.assertEqual(self.table.put_calls, [])

    def test_rejects_invalid_fields_and_lengths(self):
        with self.assertRaises(ValidationError):
            validate_create_payload({**self.payload, "priority": "Urgent"})
        with self.assertRaises(ValidationError):
            validate_create_payload({**self.payload, "category": []})
        with self.assertRaises(ValidationError):
            validate_create_payload({**self.payload, "description": "too short"})


if __name__ == "__main__":
    unittest.main()
