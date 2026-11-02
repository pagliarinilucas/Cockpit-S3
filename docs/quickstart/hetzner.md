# Hetzner Object Storage

## Endpoint and region

| Location | Endpoint | Region |
| --- | --- | --- |
| Falkenstein | `https://fsn1.your-objectstorage.com` | `fsn1` |
| Nuremberg | `https://nbg1.your-objectstorage.com` | `nbg1` |
| Helsinki | `https://hel1.your-objectstorage.com` | `hel1` |

Use the endpoint of the location where the bucket was created. Check the Hetzner documentation for locations added later.

Cockpit S3 sends path-style requests (`https://fsn1.your-objectstorage.com/bucket/key`), which Hetzner accepts.

## Credentials

1. In the Hetzner Console, open the project that holds the bucket.
2. **Security → S3 credentials → Generate credentials.** Copy the secret key immediately; it is shown only once.

Hetzner S3 credentials are **per project**: a key can access every bucket in that project. To limit what Cockpit S3 can reach, keep the buckets it should manage in a dedicated project and generate the credentials there. If you need finer control, check whether Hetzner's bucket policy support covers your case in their current documentation.

## Connection in Cockpit

**Settings → New connection**:

| Field | Value |
| --- | --- |
| S3 endpoint | `https://fsn1.your-objectstorage.com` |
| Region | `fsn1` |
| Access key / Secret key | from step 2 |
| Buckets | empty to list all buckets in the project, or a comma-separated list |

Buckets in different locations need one connection per location.
