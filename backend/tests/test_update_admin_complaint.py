import copy
import unittest

from backend.auth import ForbiddenError
from backend.complaints import update_admin_complaint
from backend.errors import ConflictError, NotFoundError, ValidationError


class FakeTable:
    def __init__(self, item=None):
        self.item = item
        self.get_item_calls = []
        self.update_calls = []

    def get_item(self, **kwargs):
        self.get_item_calls.append(kwargs)
        return {"Item": copy.deepcopy(self.item)} if self.item else {}

    def update_item(self, **kwargs):
        self.update_calls.append(kwargs)
        values = kwargs["ExpressionAttributeValues"]
        updated = copy.deepcopy(self.item)
        updated.update({
            "status": values[":status"],
            "adminRemark": values[":remark"],
            "updatedAt": values[":updatedAt"],
        })
        updated.setdefault("history", []).extend(values[":entry"])
        self.item = updated
        return {"Attributes": updated}


class UpdateAdminComplaintTests(unittest.TestCase):
    def setUp(self):
        self.complaint_id = "CC-20261124-0123456789ABCDEF0123456789ABCDEF"
        self.claims = {"sub": "verified-admin-sub", "cognito:groups": ["CampusCareAdmins"]}
        self.item = {
            "complaintId": self.complaint_id,
            "studentId": "student-sub",
            "status": "Pending",
            "adminRemark": "",
            "updatedAt": "2026-11-24T10:00:00.000Z",
            "history": [{"status": "Pending", "at": "2026-11-24T10:00:00.000Z"}],
        }

    def test_updates_status_remark_and_audit_history_atomically(self):
        table = FakeTable(self.item)
        result = update_admin_complaint(
            self.claims,
            self.complaint_id,
            {"status": "In Progress", "adminRemark": "Maintenance team notified."},
            table,
        )
        request = table.update_calls[0]
        self.assertIn("#status = :currentStatus", request["ConditionExpression"])
        self.assertIn("#adminRemark = :currentRemark", request["ConditionExpression"])
        self.assertEqual(result["status"], "In Progress")
        self.assertEqual(result["adminRemark"], "Maintenance team notified.")
        self.assertEqual(result["history"][-1]["adminId"], "verified-admin-sub")

    def test_requires_resolution_remark_and_sequential_transitions(self):
        table = FakeTable({
            **self.item,
            "status": "In Progress",
            "adminRemark": "Maintenance team is investigating.",
        })
        with self.assertRaises(ValidationError):
            update_admin_complaint(self.claims, self.complaint_id, {"status": "Resolved"}, table)
        self.assertEqual(table.update_calls, [])
        result = update_admin_complaint(
            self.claims,
            self.complaint_id,
            {"status": "Resolved", "adminRemark": "The connection has been restored."},
            table,
        )
        self.assertEqual(result["status"], "Resolved")

        with self.assertRaises(ConflictError):
            update_admin_complaint(
                self.claims,
                self.complaint_id,
                {"status": "Pending"},
                FakeTable({**self.item, "status": "Resolved"}),
            )

    def test_denies_non_admin_and_handles_invalid_or_missing_complaint(self):
        table = FakeTable(self.item)
        with self.assertRaises(ForbiddenError):
            update_admin_complaint({"sub": "student", "cognito:groups": []}, self.complaint_id, {"status": "In Progress"}, table)
        with self.assertRaises(ValidationError):
            update_admin_complaint(self.claims, "bad-id", {"status": "In Progress"}, table)
        with self.assertRaises(NotFoundError):
            update_admin_complaint(self.claims, self.complaint_id, {"status": "In Progress"}, FakeTable())
        self.assertEqual(table.update_calls, [])


if __name__ == "__main__":
    unittest.main()
