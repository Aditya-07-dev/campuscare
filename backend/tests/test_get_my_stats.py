import unittest

from backend.auth import ForbiddenError
from backend.complaints import get_my_stats


class FakeTable:
    def __init__(self, pages):
        self.pages = list(pages)
        self.query_calls = []

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.pages.pop(0)


class GetMyStatsTests(unittest.TestCase):
    def setUp(self):
        self.claims = {"sub": "verified-student-sub", "cognito:groups": []}

    def test_aggregates_statuses_and_returns_newest_complaints_across_pages(self):
        first_key = {
            "complaintId": "CC-20261124-0123456789ABCDEF0123456789ABCDEF",
            "studentId": "verified-student-sub",
            "createdAt": "2026-11-24T10:00:00.000Z",
        }
        first_item = {
            **first_key,
            "title": "Library Wi-Fi keeps disconnecting",
            "category": "IT & Wi-Fi",
            "location": "Central Library",
            "priority": "High",
            "status": "Pending",
        }
        later_item = {
            **first_item,
            "complaintId": "CC-20261123-0123456789ABCDEF0123456789ABCDEF",
            "createdAt": "2026-11-23T10:00:00.000Z",
            "status": "Resolved",
        }
        table = FakeTable([
            {"Items": [first_item], "LastEvaluatedKey": first_key},
            {"Items": [later_item]},
        ])

        result = get_my_stats(self.claims, table)

        self.assertEqual(result["totalComplaints"], 2)
        self.assertEqual(result["pendingComplaints"], 1)
        self.assertEqual(result["inProgressComplaints"], 0)
        self.assertEqual(result["resolvedComplaints"], 1)
        self.assertEqual(result["recentComplaints"][0]["complaintId"], first_item["complaintId"])
        self.assertEqual(len(result["recentComplaints"]), 2)
        self.assertEqual(len(table.query_calls), 2)
        self.assertTrue(all(call["IndexName"] == "StudentCreatedIndex" for call in table.query_calls))
        self.assertEqual(
            table.query_calls[0]["KeyConditionExpression"].get_expression()["values"][1],
            "verified-student-sub",
        )
        self.assertEqual(table.query_calls[1]["ExclusiveStartKey"], first_key)
        self.assertNotIn("Scan", table.query_calls[0])

    def test_rejects_admin_without_querying(self):
        table = FakeTable([])
        with self.assertRaises(ForbiddenError):
            get_my_stats(
                {**self.claims, "cognito:groups": ["CampusCareAdmins"]},
                table,
            )
        self.assertEqual(table.query_calls, [])


if __name__ == "__main__":
    unittest.main()
