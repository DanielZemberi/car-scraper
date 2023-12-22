const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const { Cluster } = require("puppeteer-cluster");
const UserAgent = require("user-agents");
const express = require("express");

const app = express();
const port = 3000;

async function hydrateDetailPage(previewList) {
  console.log("Starting to hydrate detail pages");

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 2,
    puppeteerOptions: {
      headless: true,
      executablePath: '/usr/bin/google-chrome',
      args: [
          "--no-sandbox",
          "--disable-gpu",
      ]
    }
  });

  await cluster.task(async ({ page, data }) => {
    try {
      console.log('1')
      const userAgent = new UserAgent();
      console.log('2')
      await page.setUserAgent(userAgent.toString());
      console.log('3')
      await page.goto(data.detailUrl, { waitUntil: 'domcontentloaded' });

      console.log('4')
      const htmlContent = await page.content();
      const $ = cheerio.load(htmlContent);
      
      console.log('5')
      const title = $(".title").text();
      const subtitle = $(".subtitle").text();
      const previewImg = $("#photoPanel").find("img").attr("src");
      const infoList = [];

      $(".modify-list .view-field").each((index, element) => {
        const title = $(element).find(".view-field-title").text();
        const value = $(element).text().replace(title, "").trim();
        infoList.push({ title: title.trim(), value });
      });

      const features = [];
      $(".features-container fieldset").each((index, element) => {
        const clusterName = $(element).find("legend").text();
        const clusterValues = [];
        $(element)
          .find(".feature-item")
          .each((index, element) => {
            clusterValues.push($(element).text().trim());
          });
        features.push({ clusterName, clusterValues });
      });

      // TODO: fetch all images in detail
      const carDetail = { title, subtitle, previewImg, infoList, features };
      data[carDetail] = carDetail;
      console.log(`Currently hydrating: ${title}`);
    } catch (error) {
      console.error(`Error scraping ${data.title}: ${error.message}`);
    } finally {
      await page.close();
    }
  });

  previewList.forEach((item) => {
    cluster.queue(item);
  });

  await cluster.idle();
  await cluster.close();
}

async function getPreviewData(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log("inside getPreviewData");

  const htmlContent = await page.content();
  const $ = cheerio.load(htmlContent);

  const carsListRaw = $(".js-announcement-list-item");
  const carsListPretty = [];
  const detailUrls = [];

  carsListRaw.each(async (index, element) => {
    const car = $(element);
    const thumbnailSrc = car.find(".thumb-inner img").attr("src");
    const thumbnailDataSrc = car.find(".thumb-inner img").attr("data-src");
    const model = car.find(".title-list").text().trim();
    const subtitle = car.find(".subtitle-list").text().trim();
    const thumbnail = thumbnailSrc?.trim()?.length
      ? thumbnailSrc
      : thumbnailDataSrc;
    const price = car.find(".price-list strong").text().trim();
    let thumbParams;

    $(".param-list-row-block").each((index, element) => {
      const spans = $(element).find("span");
      let formattedText = "";
      spans.each((spanIndex, spanElement) => {
        formattedText += $(spanElement).text();
        if (spanIndex < spans.length - 1) {
          formattedText += " | ";
        }
      });
      thumbParams = formattedText;
    });

    const detailPageUrl = car.attr("href");
    const carData = {
      thumbnail,
      model,
      subtitle,
      price,
      thumbParams,
      detailUrl: detailPageUrl,
    };
    detailUrls.push(detailPageUrl);
    carsListPretty.push(carData);
  });

  console.log(`Scraped total ${carsListPretty.length}`);
  return [carsListPretty, detailUrls];
}

app.get("/", async (req, res) => {
  let currentPage = 1;
  let totalPages = 2;

  console.log("Starting script");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: [
        "--no-sandbox",
        "--disable-gpu",
    ]
});
  console.log("Launching browser");
  const page = await browser.newPage();
  console.log("Opening page");
  await page.setUserAgent(new UserAgent().toString());
  console.log("Setting user agent");
  let allCars = [];

  const startTime = new Date().getTime();
  while (currentPage <= totalPages) {
    const startTime = new Date().getTime();

    const url = `https://en.m.autoplius.lt/ads?vip=1&order_by=3&page_nr=${currentPage}`;
    console.log(`Starting loop #${currentPage}`);

    const [previewList] = await getPreviewData(page, url);
    await hydrateDetailPage(previewList);
    allCars = allCars.concat(previewList);
    console.log("currPage", currentPage);
    currentPage++;
    const endTime = new Date().getTime();
    const elapsedTime = endTime - startTime;
    console.log(`First page took ${elapsedTime / 1000} seconds to complete.`);
  }
  const endTime = new Date().getTime();
  const elapsedTime = endTime - startTime;
  console.log("Last Car", allCars[allCars.length - 1]);
  console.log("Total Length", allCars.length);
  console.log(`The while loop took ${elapsedTime / 1000} seconds to complete.`);
  await browser.close();

  res.send(allCars);
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
