# MinIO

Cockpit S3 works with any MinIO deployment through the S3 API. Since the MinIO Community Edition console no longer manages users and policies (May 2025), Cockpit S3 can take over the "people and permissions" part. See also [Migrating from the MinIO Console](../migrating-from-minio-console.md).

## Endpoint and region

| Setting | Typical value |
| --- | --- |
| S3 endpoint | `http://minio:9000` or `https://s3.example.com` (the API port, **not** the console port 9001) |
| Region | `us-east-1` unless you set `MINIO_REGION` / `MINIO_SITE_REGION` on the server |

MinIO accepts path-style requests, which Cockpit S3 uses.

## Least-privilege key

Use the `mc` client (the admin commands are still available in `mc`).

1. Write a policy limited to one bucket, `cockpit-shared-files.json`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
         "Resource": ["arn:aws:s3:::shared-files"]
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
         "Resource": ["arn:aws:s3:::shared-files/*"]
       }
     ]
   }
   ```

2. Create the policy and a user, and attach it:

   ```bash
   mc alias set myminio https://s3.example.com ADMIN_ACCESS_KEY ADMIN_SECRET_KEY
   mc admin policy create myminio cockpit-shared-files cockpit-shared-files.json
   mc admin user add myminio cockpit-shared-files "$(openssl rand -hex 24)"
   mc admin policy attach myminio cockpit-shared-files --user cockpit-shared-files
   ```

   The user name is the access key and the generated string is the secret key. You can also create an access key (service account) under that user with `mc admin user svcacct add` and use that pair instead.

3. In Cockpit: **Settings → New connection**, endpoint `https://s3.example.com`, region `us-east-1`, the key pair, and **Buckets** = `shared-files` (the policy above does not allow `ListBuckets`).

To let Cockpit list every bucket, add a statement allowing `s3:ListAllMyBuckets` on `arn:aws:s3:::*`. To create and delete buckets from Cockpit, also allow `s3:CreateBucket` and `s3:DeleteBucket`.

## Do not use the root credentials

`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` work, but give Cockpit full control over every bucket and the server. Create a dedicated user as above.
