*** WARNING

You cannot paste this code into the Lambda console. When you do, it strips all of the ${...} items from the code.


=== ENDPOINTS ===

GET /manifest
  - Public endpoint (no authentication required)
  - Returns a JSON manifest of all songs and tracks in S3
  - Response format:
    {
      "generated": "2026-01-14T12:00:00.000Z",
      "songs": [
        { "name": "Song Name", "tracks": ["Track1.mp3", "Track2.mp3", ...] },
        ...
      ]
    }
  - Songs and tracks are sorted alphabetically

POST /arrangements
  - Requires admin secret in request body
  - Publishes a new arrangement to a song's metadata.json

DELETE /arrangements/{songName}/{arrangementName}
  - Requires admin secret in request body
  - Deletes an arrangement from a song's metadata.json


=== API GATEWAY SETUP ===

API ID: g1pan67cc9
Stage: prod
Base URL: https://g1pan67cc9.execute-api.us-east-2.amazonaws.com/prod

Resources:
  /manifest
    GET -> Lambda (worship-arrangements-api), proxy integration
  
  /arrangements
    POST -> Lambda (worship-arrangements-api), proxy integration
  
  /arrangements/{songName}/{arrangementName}
    DELETE -> Lambda (worship-arrangements-api), proxy integration


=== IAM PERMISSIONS ===

The Lambda role (worship-arrangements-lambda-role) requires:

1. S3 GetObject/PutObject for metadata files:
   Resource: arn:aws:s3:::worship-practice-app/audio/*/metadata.json

2. S3 ListBucket for manifest generation:
   Resource: arn:aws:s3:::worship-practice-app
   Condition: s3:prefix = "audio/*"

3. CloudFront CreateInvalidation:
   Resource: arn:aws:cloudfront::*:distribution/E2T6WLTS6UANVK


=== ENVIRONMENT VARIABLES ===

S3_BUCKET: worship-practice-app
CLOUDFRONT_DISTRIBUTION_ID: E2T6WLTS6UANVK
ADMIN_SECRET: (secret value)
AWS_REGION: (set automatically by Lambda)
