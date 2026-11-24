import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from backend.auth import ForbiddenError, UnauthorizedError, require_admin, user_role, verify_access_token


class AuthorizationTests(unittest.TestCase):
    def test_only_cognito_admin_group_grants_admin_role(self):
        self.assertEqual(user_role({"cognito:groups": ["CampusCareAdmins"]}), "admin")
        self.assertEqual(user_role({"cognito:groups": ["Students"]}), "student")
        self.assertEqual(user_role({}), "student")

    def test_non_admin_is_forbidden(self):
        with self.assertRaises(ForbiddenError):
            require_admin({"sub": "student-1", "cognito:groups": []})

    def test_admin_group_is_required(self):
        require_admin({"sub": "admin-1", "cognito:groups": ["CampusCareAdmins"]})

    def test_access_token_signature_and_cognito_claims_are_verified(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()
        issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool"
        token = jwt.encode({
            "iss": issuer,
            "sub": "student-1",
            "client_id": "test-client",
            "token_use": "access",
            "exp": 4102444800,
        }, private_key, algorithm="RS256", headers={"kid": "test-key"})
        client = SimpleNamespace(
            get_signing_key_from_jwt=lambda value: SimpleNamespace(key=public_key)
        )
        with patch.dict("os.environ", {
            "COGNITO_ISSUER": issuer,
            "COGNITO_APP_CLIENT_ID": "test-client",
            "CAMPUSCARE_ADMIN_GROUP": "CampusCareAdmins",
        }), patch("backend.auth._jwks_client", return_value=client):
            claims = verify_access_token(token)
        self.assertEqual(claims["sub"], "student-1")

    def test_invalid_signature_is_rejected(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool"
        token = jwt.encode({
            "iss": issuer,
            "sub": "student-1",
            "client_id": "test-client",
            "token_use": "access",
            "exp": 4102444800,
        }, private_key, algorithm="RS256", headers={"kid": "test-key"})
        client = SimpleNamespace(
            get_signing_key_from_jwt=lambda value: SimpleNamespace(key=other_key.public_key())
        )
        with patch.dict("os.environ", {
            "COGNITO_ISSUER": issuer,
            "COGNITO_APP_CLIENT_ID": "test-client",
        }), patch("backend.auth._jwks_client", return_value=client):
            with self.assertRaises(UnauthorizedError):
                verify_access_token(token)

    def test_id_token_is_not_accepted_as_api_access_token(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool"
        token = jwt.encode({
            "iss": issuer,
            "sub": "student-1",
            "client_id": "test-client",
            "token_use": "id",
            "exp": 4102444800,
        }, private_key, algorithm="RS256", headers={"kid": "test-key"})
        client = SimpleNamespace(
            get_signing_key_from_jwt=lambda value: SimpleNamespace(key=private_key.public_key())
        )
        with patch.dict("os.environ", {
            "COGNITO_ISSUER": issuer,
            "COGNITO_APP_CLIENT_ID": "test-client",
        }), patch("backend.auth._jwks_client", return_value=client):
            with self.assertRaises(UnauthorizedError):
                verify_access_token(token)

    def test_expired_access_token_is_rejected(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool"
        token = jwt.encode({
            "iss": issuer,
            "sub": "student-1",
            "client_id": "test-client",
            "token_use": "access",
            "exp": 1,
        }, private_key, algorithm="RS256", headers={"kid": "test-key"})
        client = SimpleNamespace(
            get_signing_key_from_jwt=lambda value: SimpleNamespace(key=private_key.public_key())
        )
        with patch.dict("os.environ", {
            "COGNITO_ISSUER": issuer,
            "COGNITO_APP_CLIENT_ID": "test-client",
        }), patch("backend.auth._jwks_client", return_value=client):
            with self.assertRaises(UnauthorizedError):
                verify_access_token(token)


if __name__ == "__main__":
    unittest.main()
