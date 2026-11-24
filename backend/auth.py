import os
from functools import lru_cache

import jwt
from jwt.exceptions import PyJWKClientConnectionError, PyJWTError


class UnauthorizedError(Exception):
    pass


class ForbiddenError(Exception):
    pass


class AuthServiceUnavailableError(Exception):
    pass


class AuthConfigurationError(Exception):
    pass


@lru_cache(maxsize=4)
def _jwks_client(issuer):
    return jwt.PyJWKClient(
        f"{issuer}/.well-known/jwks.json",
        cache_jwk_set=True,
        lifespan=300,
    )


def _auth_settings():
    issuer = os.environ.get("COGNITO_ISSUER", "").rstrip("/")
    client_id = os.environ.get("COGNITO_APP_CLIENT_ID", "")
    admin_group = os.environ.get("CAMPUSCARE_ADMIN_GROUP", "CampusCareAdmins")
    if not issuer or not client_id or not admin_group:
        raise AuthConfigurationError("Cognito issuer, app client ID, and admin group must be configured.")
    return issuer, client_id, admin_group


def get_bearer_token(headers):
    values = {str(key).lower(): value for key, value in (headers or {}).items()}
    authorization = values.get("authorization", "")
    scheme, separator, token = str(authorization).partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise UnauthorizedError("A Cognito access token is required.")
    return token.strip()


def verify_access_token(token):
    issuer, client_id, _ = _auth_settings()
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise UnauthorizedError("The Cognito access token has an unsupported signature.")
        signing_key = _jwks_client(issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
            leeway=30,
        )
    except PyJWKClientConnectionError as error:
        raise AuthServiceUnavailableError("Cognito signing keys could not be reached.") from error
    except PyJWTError as error:
        raise UnauthorizedError("The Cognito access token is invalid or expired.") from error

    if claims.get("token_use") != "access" or claims.get("client_id") != client_id:
        raise UnauthorizedError("The token is not an access token for this application.")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise UnauthorizedError("The Cognito token has no user identity.")
    return claims


def user_role(claims, admin_group=None):
    if admin_group is None:
        admin_group = os.environ.get("CAMPUSCARE_ADMIN_GROUP", "CampusCareAdmins")
    groups = claims.get("cognito:groups", [])
    if not isinstance(groups, list):
        return "student"
    return "admin" if admin_group in groups else "student"


def require_admin(claims):
    if user_role(claims) != "admin":
        raise ForbiddenError("Administrator membership is required.")
