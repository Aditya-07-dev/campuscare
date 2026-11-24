import unittest

from backend.auth import ForbiddenError
from backend.complaints import get_admin_stats


class FakeTable:
    def __init__(self, pages):
        self.pages = list(pages)
        self.query_calls = []

    def query(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.pages.pop(0)


class GetAdminStatsTests(unittest.TestCase):
    def setUp(self):
        self.claims = {"sub": "verified-admin-sub", "cognito:groups": ["CampusCareAdmins"]}

    def test_aggregates_projected_complaint_data_across_query_pages(self):
        first_key = {
            "complaintId": "CC-20261124-0123456789ABCDEF0123456789ABCDEF",
            "recordType": "COMPLAINT",
            "createdAt": "2026-11-24T10:00:00.000Z",
        }
        table = FakeTable([
            {
                "Items": [
                    {"status": "Pending", "category": "Facilities"},
                    {"status": "In Progress", "category": "IT & Wi-Fi"},
                ],
                "LastEvaluatedKey": first_key,
            },
            {
                "Items": [
                    {"status": "Resolved", "category": "IT & Wi-Fi"},
                    {"status": "Pending", "category": "Unknown"},
                ],
            },
        ])

        result = get_admin_stats(self.claims, table)

        self.assertEqual(result["totalComplaints"], 4)
        self.assertEqual(result["pendingComplaints"], 2)
        self.assertEqual(result["inProgressComplaints"], 1)
        self.assertEqual(result["resolvedComplaints"], 1)
        self.assertEqual(result["categories"]["Facilities"], 1)
        self.assertEqual(result["categories"]["IT & Wi-Fi"], 2)
        self.assertEqual(len(table.query_calls), 2)
        self.assertNotIn("ExclusiveStartKey", table.query_calls[0])
        self.assertEqual(table.query_calls[1]["ExclusiveStartKey"], first_key)
        self.assertEqual(table.query_calls[0]["ProjectionExpression"], "#status, #category")
        self.assertTrue(all(call["IndexName"] == "AdminCreatedIndex" for call in table.query_calls))

    def test_rejects_non_admin_without_querying(self):
        table = FakeTable([])
        with self.assertRaises(ForbiddenError):
            get_admin_stats({"sub": "student", "cognito:groups": []}, table)
        self.assertEqual(table.query_calls, [])


if __name__ == "__main__":
    unittest.main()
