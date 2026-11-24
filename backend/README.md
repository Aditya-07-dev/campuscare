# CampusCare Lambda backend

This backend uses one Python Lambda function with an AWS Lambda Function URL. It verifies Cognito access tokens in the function and stores complaint records in DynamoDB. It does not use API Gateway, S3, or frontend-supplied roles.

## Routes

Every route except `GET /health` and `OPTIONS` requires `Authorization: Bearer <Cognito access token>`.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Basic function health check |
| `GET /auth/me` | Authenticated | Return token subject, username, Cognito groups, and derived role |
| `POST /complaints` | Student | Create a complaint; body contains `title`, `category`, `location`, `priority`, and `description` |
| `GET /complaints/my?limit=20&nextToken=...` | Student | List only the caller's complaints |
| `GET /complaints/my/stats` | Student | Return the caller's totals and four newest complaints |
| `GET /complaints/{complaintId}` | Student or admin | Read a complaint; students are restricted to their own |
| `GET /admin/complaints` | Admin | Search/filter and paginate all complaints |
| `PATCH /admin/complaints/{complaintId}` | Admin | Update status and/or `adminRemark` |
| `GET /admin/stats` | Admin | Return complaint totals and category counts |
| `GET /admin/check` | Admin | Verify administrator access |

Admin list filters are optional: `category`, `priority`, `status`, and `q` (case-sensitive substring match on title). `limit` is from 1 to 50. Paginated responses have the shape `{"items": [...], "nextToken": "..."}`. A filtered page can contain fewer than `limit` results because DynamoDB applies filters after evaluating the index page; continue using `nextToken` until it is null.

Allowed categories: `Facilities`, `IT & Wi-Fi`, `Academics`, `Cleanliness`, `Safety`, `Other`.

Allowed locations: `Central Library`, `Main Block`, `Hostel`, `Cafeteria`, `Engineering Lab`, `Sports Complex`, `Other`.

Allowed priorities: `Low`, `Medium`, `High`.

Allowed statuses: `Pending`, `In Progress`, `Resolved`. Status changes are sequential: `Pending` to `In Progress`, then `In Progress` to `Resolved`. A resolution requires a non-empty administrator remark. Repeating the current status is allowed only when it also changes the remark. Each accepted update appends an audit history entry with the verified administrator subject and timestamp. Conditional writes detect concurrent updates.

The initial version intentionally does not accept or store image uploads.

## DynamoDB schema

Configure the table before deploying. The code expects:

| Attribute | Type | Use |
| --- | --- | --- |
| `complaintId` | String | Table partition key |
| `studentId` | String | Student index partition key |
| `recordType` | String | Admin index partition key; complaints use `COMPLAINT` |
| `createdAt` | String | Both index sort keys; UTC ISO-8601 timestamp |
| `status`, `category` | String | Status/category values used by list and statistics |

Create these global secondary indexes:

1. `StudentCreatedIndex`: partition key `studentId` (String), sort key `createdAt` (String).
2. `AdminCreatedIndex`: partition key `recordType` (String), sort key `createdAt` (String).

Both indexes currently need **ALL** projection: student/admin list responses return complaint details, while admin statistics project `status` and `category`. Do not deploy until the existing table and index key names and projections match. Indexes have separate capacity/billing implications; do not assume that table capacity includes their usage.

Each complaint item contains `complaintId`, `recordType`, `studentId`, `studentName`, `studentEmail`, `title`, `category`, `location`, `priority`, `description`, `status`, `adminRemark`, `createdAt`, `updatedAt`, and `history`.

## Lambda settings

Use Python 3.13 on the `x86_64` architecture (the existing setup reported Python 3.13), and set the handler to:

```text
backend.lambda_function.lambda_handler
```

Set these environment variables:

| Variable | Value |
| --- | --- |
| `DYNAMODB_TABLE` | Exact table name |
| `COGNITO_ISSUER` | `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` |
| `COGNITO_APP_CLIENT_ID` | Cognito browser app-client ID |
| `CAMPUSCARE_ADMIN_GROUP` | Exact Cognito admin group name, normally `CampusCareAdmins` |

Do not put AWS credentials in environment variables or source code. The function uses its execution role for DynamoDB. The role needs outbound HTTPS access to fetch Cognito's public signing keys; the default Lambda network configuration provides this without a VPC/NAT setup.

### Execution-role permissions

Replace the placeholders before attaching a policy. Grant only the selected table and indexes:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/<table-name>"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:<region>:<account-id>:table/<table-name>/index/StudentCreatedIndex",
        "arn:aws:dynamodb:<region>:<account-id>:table/<table-name>/index/AdminCreatedIndex"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:<region>:<account-id>:log-group:/aws/lambda/<function-name>:*"
    }
  ]
}
```

Create the Lambda log group before using this policy, or grant a narrowly scoped `logs:CreateLogGroup` permission if the function must create it. This backend does not need DynamoDB `Scan`, `DeleteItem`, or broad `dynamodb:*` access.

## Function URL and CORS

Create a Function URL for the Lambda function; do not create API Gateway. Set Function URL authorization to **NONE** because browser requests cannot sign IAM requests conveniently and the function itself verifies each Cognito bearer token. This makes the URL publicly invokable, so keep all data routes behind the backend checks and never treat CORS as authorization.

In the Function URL CORS settings:

- Allow only the exact frontend origin, such as `https://<github-user>.github.io` (not a repository path). Add `http://localhost:5500` or the local server origin only while developing.
- Allow methods `GET`, `POST`, `PATCH`, and `OPTIONS`.
- Allow headers `authorization` and `content-type`.
- Do not enable credentialed CORS.

The Cognito browser app client must separately allow the exact callback and sign-out URLs. The frontend resolves both to its `index.html`, so add the GitHub Pages URL including the repository path (for example, `https://<github-user>.github.io/<repository>/index.html`) and the exact local development URL as separate entries. These callback URLs are not Function URL CORS origins.

The browser must send the Cognito **access token** in the Authorization header. Never put tokens in URLs. Add the Function URL to the frontend configuration only after deployment and testing.

## Build and deploy

From the project root in PowerShell, install Linux-compatible dependencies into a new temporary directory, copy the backend package, and zip its contents. These options build for Python 3.13 on Lambda's `x86_64` architecture; do not omit them when building on Windows.

```powershell
$build = Join-Path $env:TEMP ("campuscare-lambda-" + [guid]::NewGuid().ToString("N"))
$backendPackage = Join-Path $build "backend"
New-Item -ItemType Directory -Force $backendPackage | Out-Null
python -m pip install -r backend\requirements.txt -t $build --platform manylinux_2_28_x86_64 --only-binary=:all: --implementation cp --python-version 3.13 --abi cp313
Copy-Item backend\__init__.py,backend\auth.py,backend\complaints.py,backend\errors.py,backend\lambda_function.py,backend\storage.py $backendPackage
Compress-Archive -Path (Join-Path $build "*") -DestinationPath backend\campuscare-lambda.zip -Force
```

Upload `backend\campuscare-lambda.zip` in the Lambda console, set the handler and environment variables above, and attach the scoped execution-role policy. Create/configure the Function URL and its CORS allowlist. Do not publish the frontend API URL until its browser requests pass the checks below. The temporary dependency directory is under `$env:TEMP`; remove only the exact generated path after the zip has been uploaded if you want to reclaim disk space.

## Local tests

From the project root:

```powershell
python -m unittest discover -s backend\tests -v
python -m compileall -q backend
```

Tests use fake DynamoDB tables; they do not call AWS or require credentials. For an AWS smoke test, use a test student account and access token, submit a complaint, verify that it appears only in that student's list, then verify admin listing, status update, remarks, and statistics with a test account in the configured Cognito admin group. Never paste tokens or credentials into source control or shared logs.

## Cost and operating limits

This code does not create AWS resources and cannot guarantee that its use is free. Lambda invocation, DynamoDB table/index storage and capacity or request consumption, CloudWatch Logs, and any account-specific plan/eligibility rules may result in charges. Check the current offer and pricing for the account and Region before deploying; do not upgrade a plan or enable paid features to proceed. Keep complaint volume and log retention small, monitor actual consumption, and test with modest request rates. A provisioned table/index can throttle when capacity is exceeded; the function returns a generic temporary-unavailability response rather than exposing AWS error details.

Admin statistics use one or more paginated Query calls over `AdminCreatedIndex` and read each complaint's projected status/category; this avoids a table Scan and large response payloads, but its read work grows with the number of complaints. For a small project, call it only when refreshing the dashboard. A maintained aggregate counter would reduce read work but requires transactional write changes and careful counter initialization/reconciliation, so it is not included in this initial backend.

Student dashboard statistics similarly paginate a `StudentCreatedIndex` Query for only the authenticated student's partition. This avoids a table Scan and returns the latest four submissions with the totals, but its read work grows with that student's complaint history. The GSI is eventually consistent, so a newly submitted complaint may take a short time to appear in the list or dashboard; the direct complaint-details lookup uses a consistent table read.
