// Prove the marketplace media path works against the REAL bucket, end to end.
//
// Run it after filling the R2_* values in .env:
//   npm run verify:r2
//
// The npm script passes --env-file-if-exists=.env, because node does NOT read a
// .env on its own — the first version of this script asked for variables that
// were sitting right there in the file.
//
// It uploads a tiny generated PNG, fetches it back over the PUBLIC url, then
// deletes it — so a pass means all three of credentials, bucket policy and
// public access are right, which is the combination that actually breaks.
//
// Nothing here prints a secret. The account id is shown truncated so you can
// confirm WHICH account answered without the value ending up in a terminal log.
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
	console.error(`Missing: ${missing.join(', ')}`);
	console.error('Add them to makutano-connect/.env, then: npm run verify:r2');
	console.error('(Running the file directly with plain `node` will not see .env.)');
	process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET_NAME!;
const publicBase = process.env.R2_PUBLIC_URL!.replace(/\/+$/, '');

console.log(`account  ${accountId.slice(0, 6)}…`);
console.log(`bucket   ${bucket}`);
console.log(`public   ${publicBase}`);

const client = new S3Client({
	region: 'auto',
	endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID!,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
	}
});

// A real 1x1 PNG — the upload path checks magic bytes, so a text file would be
// refused by the app even though the bucket would accept it.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const key = `marketplace/_verify/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
let uploaded = false;

try {
	console.log('\n1/3 upload …');
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: PNG,
			ContentType: 'image/png',
			CacheControl: 'public, max-age=60'
		})
	);
	uploaded = true;
	console.log('    ok');

	console.log('2/3 fetch over the public url …');
	const url = `${publicBase}/${key}`;
	// A brand-new object can take a moment to be readable at the edge.
	let res: Response | null = null;
	for (let attempt = 0; attempt < 5; attempt++) {
		res = await fetch(url, { cache: 'no-store' });
		if (res.ok) break;
		await new Promise((r) => setTimeout(r, 1500));
	}
	if (!res?.ok) {
		console.error(`    FAILED — ${res?.status} ${res?.statusText} at ${url}`);
		console.error('    The credentials work (the upload succeeded) but the bucket is not');
		console.error('    publicly readable. Enable public access, or point R2_PUBLIC_URL at');
		console.error('    a custom domain bound to this bucket.');
		process.exitCode = 1;
	} else {
		const bytes = new Uint8Array(await res.arrayBuffer());
		const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
		console.log(`    ok — ${bytes.byteLength} bytes, valid PNG: ${isPng}`);
		if (!isPng) process.exitCode = 1;
	}
} catch (err) {
	console.error(`\nFAILED: ${(err as Error).message}`);
	console.error('If this says SignatureDoesNotMatch the key/secret pair is wrong.');
	console.error('If it says NoSuchBucket the name is wrong or the token cannot see it.');
	process.exitCode = 1;
} finally {
	if (uploaded) {
		console.log('3/3 clean up …');
		try {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
			console.log('    ok — test object removed');
		} catch (err) {
			console.error(`    could not delete ${key}: ${(err as Error).message}`);
		}
	}
}

if (!process.exitCode) console.log('\nR2 is correctly configured for marketplace media.');
