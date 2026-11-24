class ApiError(Exception):
    status_code = 400

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ValidationError(ApiError):
    status_code = 400


class NotFoundError(ApiError):
    status_code = 404


class ConflictError(ApiError):
    status_code = 409


class ServiceUnavailableError(ApiError):
    status_code = 503


class ConfigurationError(ApiError):
    status_code = 500
