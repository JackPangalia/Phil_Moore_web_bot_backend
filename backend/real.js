import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';

// Get current file directory (ES Module equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base URL for the listings
const baseUrl = 'https://dorisgee.com/mylistings.html';

// Function to scrape a single page of listings
async function scrapePage(pageUrl) {
  try {
    console.log(`Scraping: ${pageUrl}`);
    const response = await axios.get(pageUrl);
    const $ = cheerio.load(response.data);
    
    const listings = [];
    let foundSold = false;
    
    // Process each listing on the page
    $('.mrp-listing-result').each((index, element) => {
      // Extract listing details
      const title = $(element).find('.mrp-listing-address-info h3 a').text().trim();
      const address = title.split('\n')[0].trim();
      
      const minorAddressInfo = $(element).find('.mrp-listing-minor-address-info').first().text().trim();
      const city = minorAddressInfo.split('\n')[0].trim();
      
      const postalCode = $(element).find('.mrp-listing-postal-code').text().trim();
      const subarea = $(element).find('.mrp-listing-list-subarea').text().trim();
      
      const listingUrl = $(element).find('.mrp-listing-address-info h3 a').attr('href');
      const imageUrl = $(element).find('.mrp-listing-main-image').attr('src');
      const price = $(element).find('.mrp-listing-price-container').text().trim();
      
      const status = $(element).find('.status-line span').text().trim();
      const mlsNumber = $(element).find('.mls-num-line span').text().trim();
      const bedrooms = $(element).find('.bedrooms-line span').text().trim();
      const bathrooms = $(element).find('.bathrooms-line span').text().trim();
      
      const floorArea = $(element).find('.floor-area-line #i-units1').text().trim();
      
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
        scrapedAt: new Date().toISOString()
      };
      
      listings.push(listing);
      
      // Check if any listing has a SOLD status
      if (status.toUpperCase() === 'SOLD') {
        foundSold = true;
      }
    });
    
    return { listings, foundSold };
  } catch (error) {
    console.error(`Error scraping page ${pageUrl}:`, error.message);
    return { listings: [], foundSold: false };
  }
}

// Function to scrape all pages until a SOLD listing is found
async function scrapeAllListings() {
  let currentPage = 1;
  let allListings = [];
  let foundSold = false;
  
  while (!foundSold) {
    const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?_pg=${currentPage}`;
    const { listings, foundSold: soldOnPage } = await scrapePage(pageUrl);
    
    if (listings.length === 0) {
      // No more listings found, break out of the loop
      break;
    }
    
    allListings = [...allListings, ...listings];
    
    if (soldOnPage) {
      foundSold = true;
      console.log('Found SOLD listing. Stopping scrape.');
    }
    
    currentPage++;
    
    // Add a small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return allListings;
}

// Function to save listings to a JSON file with timestamp
function saveListings(listings) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `real-estate-listings-${timestamp}.json`;
  const filePath = path.join(__dirname, 'data', fileName);
  
  // Create data directory if it doesn't exist
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
  }
  
  // Write listings to file
  fs.writeFileSync(filePath, JSON.stringify(listings, null, 2));
  
  console.log(`Saved ${listings.length} listings to ${filePath}`);
  
  // Also save to a "latest" file that overwrites the previous one
  const latestFilePath = path.join(__dirname, 'data', 'latest-listings.json');
  fs.writeFileSync(latestFilePath, JSON.stringify(listings, null, 2));
  
  return filePath;
}

// Main function to run the scraper
async function runScraper() {
  console.log('Starting scraper...');
  try {
    const listings = await scrapeAllListings();
    if (listings.length > 0) {
      const filePath = saveListings(listings);
      console.log(`Scraping completed. Found ${listings.length} listings.`);
      return filePath;
    } else {
      console.log('No listings found.');
    }
  } catch (error) {
    console.error('Error running scraper:', error);
  }
}

// Schedule the scraper to run every night at 2 AM
console.log('Setting up scheduled job to run at 2 AM daily');
cron.schedule('0 2 * * *', () => {
  console.log('Running scheduled scraper job...');
  runScraper();
});

// Also run the scraper immediately (for testing and first-time execution)
console.log('Running scraper immediately for testing...');
runScraper();

// Export functions (ES Module style)
export { runScraper, scrapeAllListings, scrapePage };