import json
import unittest
from unittest.mock import patch

from botocore.exceptions import ClientError

from backend.auth import ForbiddenError, UnauthorizedError
from backend.lambda_function import lambda_handler


class LambdaAuthorizationTests(unittest.TestCase):
    def event(self, path, authorization="", method="GET"):
        return {
            "requestContext": {"http": {"method": method, "path": path}},
            "headers": {"authorization": authorization},
        }

    def test_me_route_requires_a_valid_access_token(self):
        with patch("backend.lambda_function.verify_access_token", side_effect=UnauthorizedError("Missing token")):
            response = lambda_handler(self.event("/auth/me"), None)
        self.assertEqual(response["statusCode"], 401)

    def test_student_cannot_pass_admin_route(self):
        claims = {"sub": "student-1", "cognito:groups": []}
        with patch("backend.lambda_function.verify_access_token", return_value=claims):
            response = lambda_handler(self.event("/admin/check", "Bearer token"), None)
        self.assertEqual(response["statusCode"], 403)

    def test_admin_group_is_verified_on_admin_route(self):
        claims = {"sub": "admin-1", "cognito:groups": ["CampusCareAdmins"]}
        with patch("backend.lambda_function.verify_access_token", return_value=claims):
            response = lambda_handler(self.event("/admin/check", "Bearer token"), None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), {"ok": True, "sub": "admin-1", "role": "admin"})

    def test_health_route_does_not_require_authentication(self):
        response = lambda_handler(self.event("/health"), None)
        self.assertEqual(response["statusCode"], 200)

    def test_create_complaint_route_parses_body_and_returns_created(self):
        claims = {"sub": "student-1", "cognito:groups": []}
        payload = {
            "title": "Library Wi-Fi keeps disconnecting",
            "category": "IT & Wi-Fi",
            "location": "Central Library",
            "priority": "High",
            "description": "The connection drops every few minutes on the second floor.",
        }
        event = self.event("/complaints", "Bearer token", "POST")
        event["body"] = json.dumps(payload)
        with patch("backend.lambda_function.verify_access_token", return_value=claims), \
                patch("backend.lambda_function.get_table", return_value=object()), \
                patch("backend.lambda_function.create_complaint", return_value={"complaintId": "CC-test"}) as create:
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 201)
        self.assertEqual(create.call_args.args[:2], (claims, payload))

    def test_student_complaint_history_route_passes_query_parameters(self):
        claims = {"sub": "student-1", "cognito:groups": []}
        event = self.event("/complaints/my", "Bearer token")
        event["queryStringParameters"] = {"limit": "10"}
        with patch("backend.lambda_function.verify_access_token", return_value=claims), \
                patch("backend.lambda_function.get_table", return_value=object()), \
                patch("backend.lambda_function.list_my_complaints", return_value={"items": [], "nextToken": None}) as listing:
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(listing.call_args.args[:2], (claims, {"limit": "10"}))

    def test_student_stats_route_uses_authenticated_identity(self):
        claims = {"sub": "student-1", "cognito:groups": []}
        table = object()
        with patch("backend.lambda_function.verify_access_token", return_value=claims), \
                patch("backend.lambda_function.get_table", return_value=table), \
                patch("backend.lambda_function.get_my_stats", return_value={"totalComplaints": 0}) as stats:
            response = lambda_handler(self.event("/complaints/my/stats", "Bearer token"), None)
        self.assertEqual(response["statusCode"], 200)
        stats.assert_called_once_with(claims, table)

    def test_student_stats_route_requires_authentication(self):
        with patch("backend.lambda_function.verify_access_token", side_effect=UnauthorizedError("Missing token")), \
                patch("backend.lambda_function.get_table") as get_table:
            response = lambda_handler(self.event("/complaints/my/stats"), None)
        self.assertEqual(response["statusCode"], 401)
        get_table.assert_not_called()

    def test_admin_stats_route_is_routed(self):
        claims = {"sub": "admin-1", "cognito:groups": ["CampusCareAdmins"]}
        with patch("backend.lambda_function.verify_access_token", return_value=claims), \
                patch("backend.lambda_function.get_table", return_value=object()), \
                patch("backend.lambda_function.get_admin_stats", return_value={"totalComplaints": 0}) as stats:
            response = lambda_handler(self.event("/admin/stats", "Bearer token"), None)
        self.assertEqual(response["statusCode"], 200)
        stats.assert_called_once()

    def test_invalid_json_body_returns_validation_error(self):
        event = self.event("/complaints", "Bearer token", "POST")
        event["body"] = "{"
        with patch("backend.lambda_function.verify_access_token", return_value={"sub": "student-1"}):
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 400)
        self.assertNotIn("Traceback", response["body"])

    def test_dynamodb_errors_do_not_expose_internal_details(self):
        claims = {"sub": "student-1", "cognito:groups": []}
        event = self.event("/complaints", "Bearer token", "POST")
        event["body"] = json.dumps({"title": "title"})
        failure = ClientError(
            {"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "private detail"}},
            "PutItem",
        )
        with patch("backend.lambda_function.verify_access_token", return_value=claims), \
                patch("backend.lambda_function.get_table", return_value=object()), \
                patch("backend.lambda_function.create_complaint", side_effect=failure):
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 503)
        self.assertNotIn("private detail", response["body"])


if __name__ == "__main__":
    unittest.main()
