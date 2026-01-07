Moving to BackBlaze + CloudFlare
================================



BackBlaze B2
===============
S3 Browser works
The 'audio' folder for the app is stored here



CloudFlare
==============
Use this URL to deploy a new version:
https://dash.cloudflare.com/7acbdfcba4d9c3a7c99445fafdba2fe8/pages/view/worshippracticeapp

Zip up the entire app (except for the audio dir) and deploy that - it's all or nothing (no individual files).

Redirect was accomplished using a '_redirects' file in the application root. The content was:
/audio/*  https://f005.backblazeb2.com/file/WorshipPracticeApp/audio/:splat  301



CORS
=============
CORS was configured using:
b2-windows.exe bucket update --cors-rules "[{\"corsRuleName\":\"allowPagesDevDownload\",\"allowedOrigins\":[\"https://worshippracticeapp.pages.dev\"],\"allowedHeaders\":[\"*\"],\"allowedOperations\":[\"b2_download_file_by_id\",\"b2_download_file_by_name\"],\"exposeHeaders\":[\"x-bz-content-sha1\"],\"maxAgeSeconds\":3600}]" WorshipPracticeApp allPublic

It produced a config that looked like this:
(using: bucket get WorshipPracticeApp)
{
    "accountId": "e50b138ceacf",
    "bucketId": "4eb5603b3143988c9eba0c1f",
    "bucketInfo": {},
    "bucketName": "WorshipPracticeApp",
    "bucketType": "allPublic",
    "corsRules": [
        {
            "allowedHeaders": [
                "*"
            ],
            "allowedOperations": [
                "b2_download_file_by_id",
                "b2_download_file_by_name"
            ],
            "allowedOrigins": [
                "https://worshippracticeapp.pages.dev"
            ],
            "corsRuleName": "allowPagesDevDownload",
            "exposeHeaders": [
                "x-bz-content-sha1"
            ],
            "maxAgeSeconds": 3600
        }
    ],
    "defaultRetention": {
        "mode": null
    },
    "defaultServerSideEncryption": {
        "mode": "none"
    },
    "isFileLockEnabled": false,
    "lifecycleRules": [],
    "options": [
        "s3"
    ],
    "replication": {
        "asReplicationDestination": null,
        "asReplicationSource": null
    },
    "revision": 8
}