# Provider quickstarts

One page per S3 provider: endpoint format, region, addressing style, and how to create an access key limited to what Cockpit S3 needs.

| Provider | Page |
| --- | --- |
| Garage | [garage.md](./garage.md) |
| MinIO | [minio.md](./minio.md) |
| Hetzner Object Storage | [hetzner.md](./hetzner.md) |
| Backblaze B2 | [backblaze-b2.md](./backblaze-b2.md) |
| Wasabi | [wasabi.md](./wasabi.md) |
| AWS S3 | [aws-s3.md](./aws-s3.md) |

Oracle OCI and other S3-compatible services work the same way: you need an endpoint URL, a region, and an access key / secret key pair.

## Adding a connection

In Cockpit S3, as an admin: **Settings (Configurações) → New connection (Nova conexão)**.

| Field | Value |
| --- | --- |
| Name (Nome) | Any label, e.g. `Hetzner fsn1` |
| S3 endpoint (Endpoint S3) | The provider's endpoint URL, including `https://` |
| Region (Região) | The provider's region code. Defaults to `garage` if left empty. |
| Access key / Secret key | The key pair you created |
| Buckets | Comma-separated list of bucket names. **Leave empty to list all buckets the key can see**, using `ListBuckets`. Fill it in when the key is restricted and cannot call `ListBuckets`. |

The secret key is stored in the database and never sent back to the browser.

## What the key needs

Cockpit S3 uses these S3 operations:

| Purpose | S3 operations |
| --- | --- |
| Browse | `ListObjectsV2`, `HeadObject` |
| Preview, download, ZIP | `GetObject` |
| Upload, rename, new folder, spreadsheet editing | `PutObject`, `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload` |
| Delete | `DeleteObject`, `DeleteObjects` |
| Optional: discover buckets | `ListBuckets` |
| Optional: create / delete buckets from the UI | `CreateBucket`, `DeleteBucket` |

A key with read, write and delete on one bucket is enough for everyday use. If you only want people to read, a read-only key also works; uploads and deletions will then fail at the S3 level regardless of the permissions set in Cockpit.

## Addressing style

Cockpit S3 always sends **path-style** requests (`https://endpoint/bucket/key`). All providers listed here accept them. Use the regional endpoint without the bucket name in the hostname.

## Network

Previews and downloads are streamed through the Cockpit S3 container, so the S3 endpoint only has to be reachable from the container, not from users' browsers. The one exception is the "copy signed link" action, which produces a 5-minute presigned URL pointing at the S3 endpoint directly.
