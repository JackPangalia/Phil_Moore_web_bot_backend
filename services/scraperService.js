import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import { Command } from "commander";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VECTOR_STORE_ID = "vs_67cf8261feb481919be1939c5bdea2ab";

const baseUrl = "https://dorisgee.com/mylistings.html";

async function scrapePage(pageUrl) {
  try {
    console.log(`Scraping: ${pageUrl}`);
    const response = await axios.get(pageUrl);
    const $ = cheerio.load(response.data);

    const listings = [];
    let foundSold = false;

    $(".mrp-listing-result").each((index, element) => {
      const title = $(element)
        .find(".mrp-listing-address-info h3 a")
        .text()
        .trim();
      const address = title.split("\n")[0].trim();

      const minorAddressInfo = $(element)
        .find(".mrp-listing-minor-address-info")
        .first()
        .text()
        .trim();
      const city = minorAddressInfo.split("\n")[0].trim();

      const postalCode = $(element)
        .find(".mrp-listing-postal-code")
        .text()
        .trim();
      const subarea = $(element)
        .find(".mrp-listing-list-subarea")
        .text()
        .trim();

      const relativeListingUrl = $(element)
        .find(".mrp-listing-address-info h3 a")
        .attr("href");
      const listingUrl = `https://dorisgee.com/${relativeListingUrl}`;

      const imageElement = $(element).find(".mrp-listing-main-image");
      const imageUrl =
        imageElement.attr("data-src") || imageElement.attr("src");

      let price = $(element)
        .find(".mrp-listing-price-container")
        .text()
        .trim();

      // Clean up the price string to make it a number
      price = price.replace(/[^\d.]/g, ''); // Remove non-numeric characters except '.'
      price = parseFloat(price); // Convert to a float

      const status = $(element).find(".status-line span").text().trim();
      const mlsNumber = $(element).find(".mls-num-line span").text().trim();
      const bedrooms = $(element).find(".bedrooms-line span").text().trim();
      const bathrooms = $(element).find(".bathrooms-line span").text().trim();

      const floorArea = $(element)
        .find(".floor-area-line #i-units1")
        .text()
        .trim();

      const listing = {
        address,
        city,
        postalCode,
        subarea,
        price, // Store the numeric price
        status,
        mlsNumber,
        bedrooms,
        bathrooms,
        floorArea,
        listingUrl,
        imageUrl,
        scrapedAt: new Date().toISOString(),
      };

      listings.push(listing);

      if (status.toUpperCase() === "SOLD") {
        foundSold = true;
      }
    });

    return { listings, foundSold };
  } catch (error) {
    console.error(`Error scraping page ${pageUrl}:`, error.message);
    return { listings: [], foundSold: false };
  }
}

async function scrapeAllListings() {
  let currentPage = 1;

  let allListings = [];

  let foundSold = false;

  while (!foundSold) {
    const pageUrl =
      currentPage === 1 ? baseUrl : `${baseUrl}?_pg=${currentPage}`;

    const { listings, foundSold: soldOnPage } = await scrapePage(pageUrl);

    if (listings.length === 0) {
      break;
    }

    allListings = [...allListings, ...listings];

    if (soldOnPage) {
      foundSold = true;

      console.log("Found SOLD listing. Stopping scrape.");
    }

    currentPage++;

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return allListings;
}

async function uploadListingsToVectorStore(listings) {
  try {
    console.log(
      `Preparing to upload ${listings.length} listings to vector store...`
    );

    const tempFileName = `listings_${Date.now()}.json`;

    const tempFilePath = path.join(process.cwd(), tempFileName);

    fs.writeFileSync(tempFilePath, JSON.stringify(listings, null, 2));

    console.log(`Created temporary file: ${tempFilePath}`);

    const uploadResult = await uploadFileToOpenAI(tempFilePath);

    fs.unlinkSync(tempFilePath);

    console.log(`Deleted temporary file: ${tempFilePath}`);

    return uploadResult;
  } catch (error) {
    console.error("Error uploading listings to vector store:", error);

    throw error;
  }
}

async function uploadFileToOpenAI(filePath) {
  console.log(`Uploading file to OpenAI: ${filePath}`);

  try {
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),

      purpose: "assistants",
    });

    console.log(`File uploaded to OpenAI. File ID: ${file.id}`);

    // Delete previous files in the vector store

    await deleteExistingFilesFromVectorStore();

    const vectorStoreFile = await openai.vectorStores.files.create(
      VECTOR_STORE_ID,

      {
        file_id: file.id,
      }
    );

    console.log(
      `File added to vector store. Vector store file ID: ${vectorStoreFile.id}`
    );

    return vectorStoreFile;
  } catch (error) {
    console.error("Error uploading file to OpenAI:", error);

    throw error;
  }
}

async function deleteExistingFilesFromVectorStore() {
  try {
    console.log(`Retrieving existing files in vector store: ${VECTOR_STORE_ID}`);
   
    const vectorStoreFiles = await openai.vectorStores.files.list(VECTOR_STORE_ID);
   
    if (vectorStoreFiles.data.length > 0) {
      console.log(`Found ${vectorStoreFiles.data.length} existing files in vector store.`);
     
      for (const file of vectorStoreFiles.data) {
        // Retrieve the original file details
        const originalFile = await openai.files.retrieve(file.id);
        
        // Check if the original filename starts with 'listings_' and ends with '.json'
        if (originalFile.filename.startsWith('listings_') && originalFile.filename.endsWith('.json')) {
          console.log(`Deleting listings file ${file.id} (${originalFile.filename}) from vector store...`);
          await openai.vectorStores.files.del(VECTOR_STORE_ID, file.id);
          console.log(`Listings file ${file.id} deleted from vector store.`);
        }
      }

      console.log("Deletion process completed.");
    } else {
      console.log("No existing files found in vector store.");
    }
  } catch (error) {
    console.error("Error deleting existing files from vector store:", error);
    throw error;
  }
}

async function runScraper() {
  console.log("Starting real estate scraper...");

  try {
    const listings = await scrapeAllListings();

    if (listings.length > 0) {
      console.log(`Scraping completed. Found ${listings.length} listings.`);

      console.log("Uploading listings to OpenAI vector store...");

      const uploadResult = await uploadListingsToVectorStore(listings);

      console.log("Upload to vector store completed successfully.");

      return { listings, uploadResult };
    } else {
      console.log("No listings found.");

      return { listings: [] };
    }
  } catch (error) {
    console.error("Error running scraper:", error);

    throw error;
  }
}

const program = new Command();

program

  .name("real-estate-scraper")

  .description("Real estate scraper for Doris Gee listings")

  .version("1.0.0");

program

  .command("run")

  .description("Run the scraper immediately")

  .action(async () => {
    console.log("Manual scraper execution triggered");

    try {
      await runScraper();

      console.log("Scraper execution completed");
    } catch (error) {
      console.error("Error during manual scraper execution:", error);
    }
  });

program

  .command("upload-only")

  .description("Upload the most recent scrape results to the vector store")

  .option("-f, --file <filePath>", "Path to JSON file containing listings")

  .action(async (options) => {
    console.log("Upload-only execution triggered");

    try {
      if (options.file) {
        const filePath = path.resolve(options.file);

        if (fs.existsSync(filePath)) {
          console.log(`Using listings from file: ${filePath}`);

          const listings = JSON.parse(fs.readFileSync(filePath, "utf8"));

          await uploadListingsToVectorStore(listings);
        } else {
          console.error(`File not found: ${filePath}`);
        }
      } else {
        console.error("No file path provided. Use --file option.");
      }

      console.log("Upload-only execution completed");
    } catch (error) {
      console.error("Error during upload-only execution:", error);
    }
  });

// Parse command line arguments if run directly

if (process.argv.length > 2) {
  program.parse(process.argv);
}

// Initialize the scraper service with timezone support for scheduling

function initScraperService() {
  console.log("Initializing real estate scraper service...");

  // Schedule the scraper to run every night at 2 AM.

  // The timezone can be configured with an environment variable TIMEZONE, defaulting to 'UTC'

  cron.schedule("* * * * *", async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled scraper...`);

    await runScraper();

    console.log(`[${new Date().toISOString()}] Scheduled scraper completed.`);
  });

  console.log("Scraper service initialized. Scheduled to run daily at 2 AM.");

  console.log("To run the scraper manually, use: node scraperService.js run");

  console.log(
    "To upload existing listings, use: node scraperService.js upload-only --file path/to/listings.json"
  );
}

export {
  initScraperService,
  runScraper,
  scrapeAllListings,
  scrapePage,
  uploadListingsToVectorStore,
  uploadFileToOpenAI,
  deleteExistingFilesFromVectorStore,
};
