require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

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
app.get("/api/image", async (req, res) => {
  const images = [
    { id: "image1.jpg", url: `https://${BUCKET_NAME}.s3.amazonaws.com/image1.jpg` },
    { id: "image2.jpg", url: `https://${BUCKET_NAME}.s3.amazonaws.com/image2.jpg` },
  ];
  const randomImage = images[Math.floor(Math.random() * images.length)];
  res.json(randomImage);
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