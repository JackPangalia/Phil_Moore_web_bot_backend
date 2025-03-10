// src/index.js
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cron from 'node-cron';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const BASE_URL = 'https://dorisgee.com';
const LISTINGS_URL = `${BASE_URL}/mylistings.html`;
const OUTPUT_DIR = path.join(__dirname, '../data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `listings-${new Date().toISOString().split('T')[0]}.json`);

// Ensure output directory exists
async function ensureDirectoryExists() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    console.log(`Directory created/verified: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
    throw error;
  }
}

// Get HTML content from URL
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      },
      timeout: 30000
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}: ${error.message}`);
    return null;
  }
}

// Extract listing URLs from a listings page
function extractListingUrls(html) {
  try {
    const $ = cheerio.load(html);
    const listingUrls = [];
    
    $('ul.mrp-listing-results li.mrp-listing-result').each((_, element) => {
      const linkElement = $(element).find('div.mrp-listing-details-link a');
      if (linkElement.length) {
        const href = linkElement.attr('href');
        if (href) {
          // Ensure we have the full URL
          const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
          listingUrls.push(fullUrl);
        }
      }
    });
    
    return listingUrls;
  } catch (error) {
    console.error(`Error extracting listing URLs: ${error.message}`);
    return [];
  }
}

// Extract data from an individual listing page
function extractListingData($, url) {
  try {
    const listingData = {
      url,
      scrapedAt: new Date().toISOString(),
      description: $('.mrp-listing-description').text().trim(),
      sections: {}
    };

    // Extract data from all specified sections
    const sectionSelectors = [
      '.info-section-RED-4',
      '.info-section-RED-5',
      '.room-info-section',
      '.bathroom-info-section',
      '.info-section-RED-2-4',
      '.info-section-RED-2-5',
      '.info-section-RED-2-6',
      '.info-section-RED-2-7',
      '.info-section-RED-2-8',
      '.info-section-RED-7',
      '.info-section-RED-8'
    ];

    sectionSelectors.forEach(selector => {
      const sectionData = {};
      $(selector).each((_, section) => {
        // Extract all text content from this section
        sectionData[selector] = $(section).text().trim();
        
        // Also try to extract any structured data (key-value pairs)
        $(section).find('*').each((_, element) => {
          const $element = $(element);
          const key = $element.attr('class') || $element.attr('id') || $element.prop('tagName').toLowerCase();
          const value = $element.text().trim();
          if (key && value && !key.includes('mrp-listing') && key !== 'div' && key !== 'span') {
            sectionData[key] = value;
          }
        });
      });
      
      // Add to the main data object
      if (Object.keys(sectionData).length > 0) {
        listingData.sections[selector.replace('.', '')] = sectionData;
      }
    });

    return listingData;
  } catch (error) {
    console.error(`Error extracting data from listing ${url}: ${error.message}`);
    return { url, error: error.message };
  }
}

// Scrape all listings from multiple pages
async function scrapeAllListings(maxPages = 10) {
  try {
    let allListingUrls = [];
    let currentPage = 1;
    let hasNextPage = true;
    
    console.log('Starting to scrape listing pages...');
    
    // Loop through pagination pages to collect all listing URLs
    while (hasNextPage && currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? LISTINGS_URL : `${LISTINGS_URL}?_pg=${currentPage}`;
      console.log(`Scraping listing page ${currentPage}: ${pageUrl}`);
      
      const html = await fetchHtml(pageUrl);
      if (!html) {
        console.log(`No HTML content returned for page ${currentPage}, stopping pagination.`);
        break;
      }
      
      const listingUrls = extractListingUrls(html);
      console.log(`Found ${listingUrls.length} listings on page ${currentPage}`);
      
      if (listingUrls.length === 0) {
        console.log('No listings found on this page, stopping pagination.');
        hasNextPage = false;
      } else {
        allListingUrls = [...allListingUrls, ...listingUrls];
        currentPage++;
        
        // Add a small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Total listing URLs collected: ${allListingUrls.length}`);
    
    // Now scrape each individual listing
    const allListingsData = [];
    let counter = 0;
    
    for (const url of allListingUrls) {
      counter++;
      console.log(`Scraping listing ${counter}/${allListingUrls.length}: ${url}`);
      
      const html = await fetchHtml(url);
      if (html) {
        const $ = cheerio.load(html);
        const listingData = extractListingData($, url);
        allListingsData.push(listingData);
        
        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`Failed to fetch HTML for ${url}`);
        allListingsData.push({ url, error: 'Failed to fetch HTML' });
      }
    }
    
    return allListingsData;
  } catch (error) {
    console.error(`Error in scrapeAllListings: ${error.message}`);
    throw error;
  }
}

// Save data to file
async function saveDataToFile(data, filePath) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Data saved to ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error saving data to file: ${error.message}`);
    return false;
  }
}

// Main function to run the scraper
async function runScraper() {
  try {
    console.log(`Starting scraper run at ${new Date().toISOString()}`);
    
    await ensureDirectoryExists();
    const listingsData = await scrapeAllListings();
    
    const outputFile = path.join(OUTPUT_DIR, `listings-${new Date().toISOString().split('T')[0]}.json`);
    await saveDataToFile(listingsData, outputFile);
    
    console.log(`Scraper run completed successfully at ${new Date().toISOString()}`);
    return { success: true, count: listingsData.length, outputFile };
  } catch (error) {
    console.error(`Scraper run failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Schedule daily runs using cron
function scheduleDaily() {
  // Run every day at 1:00 AM
  cron.schedule('0 1 * * *', async () => {
    console.log('Running scheduled scraper job');
    await runScraper();
  });
  
  console.log('Scraper scheduled to run daily at 1:00 AM');
}

// Run immediately if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    await runScraper();
    scheduleDaily();
  })();
}

// Export functions for use in other modules
export {
  runScraper,
  scheduleDaily
};