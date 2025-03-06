require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");


const app = express();
app.use(cors());
app.use(express.json());

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const RATINGS_FILE = "ratings.json";

// Helper function to convert stream to string
const streamToString = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
};

// Function to fetch the ratings.json file from S3
async function getRatings() {
  try {
    const data = await s3.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: RATINGS_FILE,
    }));
    
    const body = await streamToString(data.Body);
    return JSON.parse(body);
  } catch (error) {
    console.error("Error fetching ratings:", error);
    return {}; // Return empty object if file doesn't exist
  }
}

// Function to save updated ratings to S3
async function saveRatings(ratings) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: RATINGS_FILE,
      Body: JSON.stringify(ratings, null, 2),
      ContentType: "application/json",
    }));
  } catch (error) {
    console.error("Error saving ratings:", error);
  }
}

// API Route to Get a Random Image
//app.get("/api/image", async (req, res) => {
//  const images = [
//    { id: "image1.jpg", url: `https://${BUCKET_NAME}.s3.amazonaws.com/image1.jpg` },
//    { id: "image2.jpg", url: `https://${BUCKET_NAME}.s3.amazonaws.com/image2.jpg` },
//  ];
//  const randomImage = images[Math.floor(Math.random() * images.length)];
//  res.json(randomImage);
// });

// API Route to Get a Random Image (Fetch from S3)
//app.get("/api/image", async (req, res) => {
//  try {
//    // Fetch list of images from S3 bucket
//    const data = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }));

//    // Filter only image files (JPG, PNG, etc.)
//    const imageKeys = data.Contents
//      .filter(item => item.Key.match(/\.(jpg|jpeg|png|gif)$/)) // Only images
//      .map(item => item.Key); // Extract file names

//    // If no images found, return an error
//    if (imageKeys.length === 0) {
//      return res.status(404).json({ error: "No images found in the bucket" });
//    }

//    // Select a random image from the bucket
//    const randomImageKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];

//    // Return the image URL
//    res.json({
//      id: randomImageKey,
//      url: `https://${BUCKET_NAME}.s3.amazonaws.com/${randomImageKey}`,
//    });

//  } catch (error) {
//    console.error("Error fetching images from S3:", error);
//    res.status(500).json({ error: "Error retrieving images" });
//  }
//});
//app.get("/api/image", async (req, res) => {
//  try {
//    // Fetch list of all images from S3
//    const data = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }));
//    const imageKeys = data.Contents.map(item => item.Key);

//    // Fetch rated images from S3 (ratings.json)
//    const ratings = await getRatings();
//    const ratedImages = Object.keys(ratings); // List of images that have been rated

//    // Filter out images that have been rated
//    const unratedImages = imageKeys.filter(image => !ratedImages.includes(image));

//    if (unratedImages.length === 0) {
//      return res.status(404).json({ error: "No unrated images left!" });
//    }

//    // Select a random unrated image
//    const randomImageKey = unratedImages[Math.floor(Math.random() * unratedImages.length)];

//    res.json({ id: randomImageKey, url: `https://${BUCKET_NAME}.s3.amazonaws.com/${randomImageKey}` });

//  } catch (error) {
//    console.error("Error fetching images from S3:", error);
//    res.status(500).json({ error: "Error retrieving images" });
//  }
//});

app.get("/api/image", async (req, res) => {
  try {
    let images = [];
    let continuationToken = null;
    
    // Step 1: Fetch ALL images (pagination handles >1000 images)
    do {
      const params = { Bucket: BUCKET_NAME, MaxKeys: 1000 };
      if (continuationToken) params.ContinuationToken = continuationToken;
      const data = await s3.send(new ListObjectsV2Command(params));
      images = images.concat(data.Contents.map(item => item.Key));
      continuationToken = data.NextContinuationToken;
    } while (continuationToken);
    
    // Step 2: Fetch rated images from S3 (ratings.json)
    const ratings = await getRatings();
    const ratedImages = Object.keys(ratings);
    
    // Step 3: Remove images that have been rated
    let unratedImages = images.filter(image => !ratedImages.includes(image));
    if (unratedImages.length === 0) {
      return res.status(404).json({ error: "No unrated images left!" });
    }
    
    // Step 4: Use Fisher-Yates algorithm for proper shuffling
    function fisherYatesShuffle(array) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    
    // Apply proper shuffling
    const shuffledImages = fisherYatesShuffle(unratedImages);
    
    // Step 5: Select a truly random image
    const randomImageKey = shuffledImages[0];
    
    res.json({ 
      id: randomImageKey, 
      url: `https://${BUCKET_NAME}.s3.amazonaws.com/${randomImageKey}`,
      remaining: unratedImages.length
    });
  } catch (error) {
    console.error("Error fetching images from S3:", error);
    res.status(500).json({ error: "Error retrieving images" });
  }
});

// API Route to Submit a Rating
app.post("/api/rate", async (req, res) => {
  const { imageId, rating } = req.body;
  if (!imageId || rating === undefined) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const ratings = await getRatings();
  if (!ratings[imageId]) {
    ratings[imageId] = { ratings: [] };
  }
  ratings[imageId].ratings.push(rating);

  await saveRatings(ratings);
  res.json({ message: "Rating saved", ratings: ratings[imageId] });
});

// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});