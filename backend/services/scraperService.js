import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cron from "node-cron";
import { Command } from "commander";
import OpenAI from "openai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Vector store ID
const VECTOR_STORE_ID = "vs_67cf8261feb481919be1939c5bdea2ab";

// Base URL for the listings
const baseUrl = "https://dorisgee.com/mylistings.html";

/**
 * Scrape a single page of real estate listings
 * @param {string} pageUrl - URL of the page to scrape
 * @returns {Object} - Object containing listings array and boolean indicating if SOLD listing was found
 */
async function scrapePage(pageUrl) {
  try {
    console.log(`Scraping: ${pageUrl}`);
    const response = await axios.get(pageUrl);
    const $ = cheerio.load(response.data);
    
    // Extract the base domain from the pageUrl for creating absolute URLs
    const urlObj = new URL(pageUrl);
    const domain = `${urlObj.protocol}//${urlObj.hostname}`;
    
    const listings = [];
    let foundSold = false;

    // Process each listing on the page
    $(".mrp-listing-result").each((index, element) => {
      // Extract listing details
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

      // Extract listing URL and convert to absolute URL
      const relativeListingUrl = $(element)
        .find(".mrp-listing-address-info h3 a")
        .attr("href");
      const listingUrl = relativeListingUrl ? new URL(relativeListingUrl, domain).toString() : "";
      
      // Extract and process image URL
      const imageElement = $(element).find(".mrp-listing-main-image");
      let imageUrl = imageElement.attr("src");
      
      // If src is a placeholder, try alternative attributes
      if (!imageUrl || imageUrl.startsWith("data:image")) {
        imageUrl = imageElement.attr("data-src") || 
                  imageElement.attr("data-original") || 
                  imageElement.attr("data-lazy-src") ||
                  imageElement.attr("data-lazy");
                
        // If still no image, try looking for background-image in style
        if (!imageUrl) {
          const style = imageElement.attr("style");
          if (style && style.includes("background-image")) {
            const match = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
            if (match && match[1]) {
              imageUrl = match[1];
            }
          }
        }
      }
      
      // Make sure we have an absolute URL for images
      if (imageUrl && !imageUrl.startsWith("data:image") && !imageUrl.startsWith("http")) {
        imageUrl = new URL(imageUrl, domain).toString();
      }

      const price = $(element)
        .find(".mrp-listing-price-container")
        .text()
        .trim();

      const status = $(element).find(".status-line span").text().trim();
      const mlsNumber = $(element).find(".mls-num-line span").text().trim();
      const bedrooms = $(element).find(".bedrooms-line span").text().trim();
      const bathrooms = $(element).find(".bathrooms-line span").text().trim();

      const floorArea = $(element)
        .find(".floor-area-line #i-units1")
        .text()
        .trim();

      // Create listing object
      const listing = {
        address,
        city,
        postalCode,
        subarea,
        price,
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

      // Check if any listing has a SOLD status
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
/**
 * Scrape all pages until a SOLD listing is found
 * @returns {Array} - Array of all listing objects
 */
async function scrapeAllListings() {
  let currentPage = 1;
  let allListings = [];
  let foundSold = false;

  while (!foundSold) {
    const pageUrl =
      currentPage === 1 ? baseUrl : `${baseUrl}?_pg=${currentPage}`;
    const { listings, foundSold: soldOnPage } = await scrapePage(pageUrl);

    if (listings.length === 0) {
      // No more listings found, break out of the loop
      break;
    }

    allListings = [...allListings, ...listings];

    if (soldOnPage) {
      foundSold = true;
      console.log("Found SOLD listing. Stopping scrape.");
    }

    currentPage++;

    // Add a small delay to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return allListings;
}

/**
 * Function to upload scraped listings to OpenAI vector store
 * @param {Array} listings - Array of scraped real estate listings
 * @returns {Object} - Result of the vector store upload operation
 */
async function uploadListingsToVectorStore(listings) {
  try {
    console.log(`Preparing to upload ${listings.length} listings to vector store...`);
    
    // Create a temporary JSON file with the listings data
    const tempFileName = `listings_${Date.now()}.json`;
    const tempFilePath = path.join(process.cwd(), tempFileName);
    
    // Convert listings to JSON and write to file
    fs.writeFileSync(tempFilePath, JSON.stringify(listings, null, 2));
    console.log(`Created temporary file: ${tempFilePath}`);
    
    // Upload the file to OpenAI
    const uploadResult = await uploadFileToOpenAI(tempFilePath);
    
    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    console.log(`Deleted temporary file: ${tempFilePath}`);
    
    return uploadResult;
  } catch (error) {
    console.error("Error uploading listings to vector store:", error);
    throw error;
  }
}

/**
 * Upload a file to OpenAI and add it to the vector store
 * @param {string} filePath - Path to the file to upload
 * @returns {Object} - The vector store file object
 */
async function uploadFileToOpenAI(filePath) {
  console.log(`Uploading file to OpenAI: ${filePath}`);
  try {
    // Upload file to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });
    
    console.log(`File uploaded to OpenAI. File ID: ${file.id}`);
    
    // Delete previous files in the vector store
    await deleteExistingFilesFromVectorStore();
    
    // Add the new file to the vector store
    const vectorStoreFile = await openai.beta.vectorStores.files.create(
      VECTOR_STORE_ID,
      {
        file_id: file.id,
      }
    );
    
    console.log(`File added to vector store. Vector store file ID: ${vectorStoreFile.id}`);
    return vectorStoreFile;
  } catch (error) {
    console.error("Error uploading file to OpenAI:", error);
    throw error;
  }
}

/**
 * Delete all existing files from the vector store
 */
async function deleteExistingFilesFromVectorStore() {
  try {
    console.log(`Retrieving existing files in vector store: ${VECTOR_STORE_ID}`);
    
    // List all files in the vector store
    const vectorStoreFiles = await openai.beta.vectorStores.files.list(VECTOR_STORE_ID);
    
    if (vectorStoreFiles.data.length > 0) {
      console.log(`Found ${vectorStoreFiles.data.length} existing files in vector store.`);
      
      // Delete each file from the vector store
      for (const file of vectorStoreFiles.data) {
        console.log(`Deleting file ${file.id} from vector store...`);
        await openai.beta.vectorStores.files.delete(VECTOR_STORE_ID, file.id);
        console.log(`File ${file.id} deleted from vector store.`);
      }
    } else {
      console.log("No existing files found in vector store.");
    }
  } catch (error) {
    console.error("Error deleting existing files from vector store:", error);
    throw error;
  }
}

/**
 * Main function to run the scraper and upload results to vector store
 */
async function runScraper() {
  console.log("Starting real estate scraper...");
  try {
    const listings = await scrapeAllListings();
    if (listings.length > 0) {
      console.log(`Scraping completed. Found ${listings.length} listings.`);
      
      // Upload to vector store
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

// Setup command line interface
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
  .option('-f, --file <filePath>', 'Path to JSON file containing listings')
  .action(async (options) => {
    console.log("Upload-only execution triggered");
    try {
      if (options.file) {
        const filePath = path.resolve(options.file);
        if (fs.existsSync(filePath)) {
          console.log(`Using listings from file: ${filePath}`);
          const listings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

// Initialize the scraper service
function initScraperService() {
  console.log("Initializing real estate scraper service...");

  // Schedule the scraper to run every night at 2 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("Running scheduled scraper job...");
    try {
      await runScraper();
      console.log("Scheduled scraper execution completed");
    } catch (error) {
      console.error("Error during scheduled scraper execution:", error);
    }
  });

  console.log("Scraper service initialized. Scheduled to run daily at 2 AM.");
  console.log("To run the scraper manually, use: node scraperService.js run");
  console.log("To upload existing listings, use: node scraperService.js upload-only --file path/to/listings.json");
}

// Export functions and initialize service
export { 
  initScraperService, 
  runScraper, 
  scrapeAllListings, 
  scrapePage, 
  uploadListingsToVectorStore, 
  uploadFileToOpenAI, 
  deleteExistingFilesFromVectorStore 
};