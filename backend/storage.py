import os

from .errors import ConfigurationError


def get_table():
    table_name = os.environ.get("DYNAMODB_TABLE", "")
    if not table_name:
        raise ConfigurationError("The DynamoDB table is not configured.")

    import boto3

    return boto3.resource("dynamodb").Table(table_name)
