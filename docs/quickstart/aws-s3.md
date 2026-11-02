# AWS S3

## Endpoint and region

| Setting | Example |
| --- | --- |
| S3 endpoint | `https://s3.<region>.amazonaws.com`, e.g. `https://s3.eu-west-1.amazonaws.com` |
| Region | the bucket's region, e.g. `eu-west-1` |

The region must match the bucket's region, otherwise requests fail with a redirect or signature error. Buckets in different regions need one connection per region.

Cockpit S3 sends path-style requests (`https://s3.eu-west-1.amazonaws.com/bucket/key`). AWS still accepts path-style requests; bucket names containing dots also work this way.

## IAM user with a policy for one bucket

1. IAM → **Policies → Create policy → JSON**:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "BucketLevel",
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
         "Resource": "arn:aws:s3:::shared-files"
       },
       {
         "Sid": "ObjectLevel",
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

   If the bucket uses SSE-KMS with a customer-managed key, also allow `kms:Decrypt` and `kms:GenerateDataKey` on that key.

2. IAM → **Users → Create user** (no console access), attach the policy.
3. User → **Security credentials → Create access key** → "Application running outside AWS". Save the secret.

## Connection in Cockpit

**Settings → New connection**:

| Field | Value |
| --- | --- |
| S3 endpoint | `https://s3.eu-west-1.amazonaws.com` |
| Region | `eu-west-1` |
| Access key / Secret key | from step 3 |
| Buckets | `shared-files` (required: the policy does not allow `s3:ListAllMyBuckets`) |

## Notes

- Long-lived IAM user keys are the only credential type Cockpit S3 supports today (no instance roles or STS). Rotate them periodically: create a second access key, update the connection, delete the old key.
- Keep **Block Public Access** enabled on the bucket. Cockpit's public share links are served by Cockpit, not by S3, so the bucket never needs to be public.
- Downloads through Cockpit are billed as S3 data transfer out unless Cockpit runs in the same region.
