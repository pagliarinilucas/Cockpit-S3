# Backblaze B2

## Endpoint and region

The S3 endpoint is shown on the bucket's details page in the Backblaze web UI ("Endpoint"). It has the form:

| Setting | Example |
| --- | --- |
| S3 endpoint | `https://s3.us-west-004.backblazeb2.com` |
| Region | `us-west-004` (the part between `s3.` and `.backblazeb2.com`) |

The region is fixed per account/bucket; use exactly the value shown for your bucket. B2 accepts path-style requests, which Cockpit S3 uses.

## Application key restricted to one bucket

The **master application key cannot be used with the S3-compatible API**. Create an application key:

**Web UI:** **Application Keys → Add a New Application Key**

- Name: `cockpit-shared-files`
- Allow access to bucket(s): **only** the bucket Cockpit should manage
- Type of access: **Read and Write**

**CLI** (B2 command-line tool v4):

```bash
b2 key create --bucket shared-files cockpit-shared-files \
  listBuckets,listFiles,readFiles,writeFiles,deleteFiles
```

(Older versions of the CLI use `b2 create-key` with the same arguments.)

Save the `keyID` (access key) and `applicationKey` (secret key); the secret is shown only once.

A key restricted to one bucket can only see that bucket in `ListBuckets`, so you may leave the **Buckets** field empty or set it to the bucket name.

## Connection in Cockpit

**Settings → New connection**:

| Field | Value |
| --- | --- |
| S3 endpoint | `https://s3.us-west-004.backblazeb2.com` |
| Region | `us-west-004` |
| Access key | the `keyID` |
| Secret key | the `applicationKey` |
| Buckets | `shared-files` |

## Notes

- B2 keeps previous versions of overwritten and deleted files by default ("Keep all versions"). A delete through the S3 API without a version ID hides the file rather than erasing its data, so old versions keep using storage until a lifecycle rule removes them. Configure the bucket lifecycle in B2 to match your retention needs (see the B2 documentation on lifecycle rules).
- Downloads through Cockpit count as B2 egress from the bucket to wherever Cockpit runs.
