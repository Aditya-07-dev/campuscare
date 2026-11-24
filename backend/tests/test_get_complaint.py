import unittest

from backend.auth import ForbiddenError
from backend.complaints import get_complaint
from backend.errors import NotFoundError, ValidationError


class FakeTable:
    def __init__(self, item=None):
        self.item = item
        self.get_item_calls = []

    def get_item(self, **kwargs):
        self.get_item_calls.append(kwargs)
        return {"Item": self.item} if self.item else {}


class GetComplaintTests(unittest.TestCase):
    def setUp(self):
        self.complaint_id = "CC-20261124-0123456789ABCDEF0123456789ABCDEF"
        self.claims = {"sub": "verified-student-sub", "cognito:groups": []}
        self.item = {
            "complaintId": self.complaint_id,
            "studentId": "verified-student-sub",
            "title": "Library Wi-Fi keeps disconnecting",
            "status": "Pending",
        }

    def test_student_can_read_own_complaint_with_consistent_lookup(self):
        table = FakeTable(self.item)
        result = get_complaint(self.claims, self.complaint_id, table)
        self.assertEqual(
            table.get_item_calls,
            [{"Key": {"complaintId": self.complaint_id}, "ConsistentRead": True}],
        )
        self.assertEqual(result["complaintId"], self.complaint_id)
        self.assertEqual(result["adminRemark"], "")

    def test_student_cannot_read_another_students_complaint(self):
        table = FakeTable({**self.item, "studentId": "another-student"})
        with self.assertRaises(ForbiddenError):
            get_complaint(self.claims, self.complaint_id, table)

    def test_admin_can_read_any_complaint(self):
        admin_claims = {**self.claims, "cognito:groups": ["CampusCareAdmins"]}
        result = get_complaint(admin_claims, self.complaint_id, FakeTable(
            {**self.item, "studentId": "another-student"}
        ))
        self.assertEqual(result["studentId"], "another-student")

    def test_rejects_malformed_and_missing_complaints(self):
        table = FakeTable(self.item)
        with self.assertRaises(ValidationError):
            get_complaint(self.claims, "not-an-id", table)
        self.assertEqual(table.get_item_calls, [])
        with self.assertRaises(NotFoundError):
            get_complaint(self.claims, self.complaint_id, FakeTable())


if __name__ == "__main__":
    unittest.main()
