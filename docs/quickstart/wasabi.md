# Wasabi

## Endpoint and region

| Setting | Example |
| --- | --- |
| S3 endpoint | `https://s3.<region>.wasabisys.com`, e.g. `https://s3.eu-central-1.wasabisys.com` |
| Region | the region code, e.g. `eu-central-1` |

For `us-east-1`, both `https://s3.wasabisys.com` and `https://s3.us-east-1.wasabisys.com` work. Use the endpoint of the region where the bucket lives; Wasabi's documentation lists all service URLs. Wasabi accepts path-style requests, which Cockpit S3 uses.

## Least-privilege key

Wasabi supports IAM-style users and policies.

1. **Policies → Create policy**, name `cockpit-shared-files`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
         "Resource": "arn:aws:s3:::shared-files"
       },
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject",
           "s3:AbortMultipartUpload",
           "s3:ListMultipartUploadParts"
         ],
         "Resource": "arn:aws:s3:::shared-files/*"
       }
     ]
   }
   ```

2. **Users → Create user**, programmatic access only (no console access), attach the `cockpit-shared-files` policy.
3. Create an access key for that user and save the secret.

## Connection in Cockpit

**Settings → New connection** with the regional endpoint, the region code, the key pair, and **Buckets** = `shared-files` (the policy above does not allow `ListBuckets`).

## Notes

- Wasabi has a minimum storage duration per object (check your plan); deleting files soon after upload is still billed for that period.
- Do not use the root account's keys.
