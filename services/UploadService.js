const B2 = require("backblaze-b2");
const sharp = require("sharp");

//Envs
const BACKBLAZE_APPLICATION_KEY_ID = process.env.BACKBLAZE_APPLICATION_KEY_ID;
const BACKBLAZE_APPLICATION_KEY = process.env.BACKBLAZE_APPLICATION_KEY;
const BACKBLAZE_BUCKET_NAME = process.env.BACKBLAZE_BUCKET_NAME;
const BACKBLAZE_CDN_ENDPOINT = process.env.BACKBLAZE_CDN_ENDPOINT;

//Checks
if (!BACKBLAZE_APPLICATION_KEY_ID)
  throw new Error("BACKBLAZE_APPLICATION_KEY_ID is not set");
if (!BACKBLAZE_APPLICATION_KEY)
  throw new Error("BACKBLAZE_APPLICATION_KEY is not set");
if (!BACKBLAZE_BUCKET_NAME) throw new Error("BACKBLAZE_BUCKET_NAME is not set");
if (!BACKBLAZE_CDN_ENDPOINT)
  throw new Error("BACKBLAZE_CDN_ENDPOINT is not set");

class UploadService {
  constructor() {
    this.b2 = new B2({
      applicationKeyId: BACKBLAZE_APPLICATION_KEY_ID,
      applicationKey: BACKBLAZE_APPLICATION_KEY,
    });
    this.bucketName = BACKBLAZE_BUCKET_NAME;
  }

  /**
   * @description Upload a file to Backblaze B2
   * @param {Buffer} BUFFER - The buffer to upload
   * @param {string} FILE_PATH - The path of the file
   * @returns {Promise<Object>} The result of the upload
   */
  async uploadFile(BUFFER, FILE_PATH) {
    try {
      // Authorize
      await this.b2.authorize();

      // Get Bucket
      const bucketsResponse = await this.b2.listBuckets();
      const bucket = bucketsResponse.data.buckets.find(
        (b) => b.bucketName === this.bucketName
      );
      if (!bucket) {
        console.error(`Bucket ${this.bucketName} not found`);
        return { status: false, error: `Bucket ${this.bucketName} not found` };
      }
      const bucketId = bucket.bucketId;

      // Get upload URL
      const uploadUrlResponse = await this.b2.getUploadUrl({
        bucketId: bucketId,
      });

      // Upload File
      await this.b2.uploadFile({
        uploadUrl: uploadUrlResponse.data.uploadUrl,
        uploadAuthToken: uploadUrlResponse.data.authorizationToken,
        fileName: FILE_PATH,
        data: BUFFER,
      });

      return { status: true };
    } catch (error) {
      console.error(error);
      return { status: false, error: error.message };
    }
  }

  /**
   * @description Compress an image
   * @param {Buffer} BUFFER - The buffer to compress
   * @returns {Promise<Buffer>} The compressed buffer
   */
  async compressImage(BUFFER) {
    return new Promise((resolve, reject) => {
      sharp(BUFFER)
        .toFormat("jpeg")
        .jpeg({ quality: 80, progressive: true })
        .toBuffer()
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * @description Generate a URL for a file
   * @param {string} FILE_PATH - The path of the file
   * @returns {string} The URL of the file
   */
  generateUrl(FILE_PATH) {
    return `${BACKBLAZE_CDN_ENDPOINT}file/${BACKBLAZE_BUCKET_NAME}/${FILE_PATH}`;
  }
}

module.exports = new UploadService();
