import puppeteer from "puppeteer";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * 1. Use puppeteer to scrape token name, symbols and addresses from etherscans /token pages
 * 2. Get CoinMarketCap id map
 * 3. Map Etherscan symbols to CMC id
 *   - multiple erc20 tokens can have the same symbol. we pick the cmc id with the highest marketcap. this is an imperfect solution.
 * 4. Use CMC id to download the logo
 *   - there are technically logos right on the etherscan pages, but they are not as high resolution.
 */
const Exec = async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36"
  );

  const targets = [
    ["ethereum", "https://etherscan.io/tokens", 19],
    ["polygon", "https://polygonscan.com/tokens", 7],
    ["arbitrum", "https://arbiscan.io/tokens", 2],
    ["optimism", "https://optimistic.etherscan.io/tokens", 1],
  ];

  for (const target of targets) {
    let contracts: any[] = [];
    const [name, url, count] = target;

    for (let i = 1; i <= count; i++) {
      await page.goto(`${url}?p=${i}`, {
        waitUntil: "networkidle0",
      });

      const data = await page.evaluate(() => {
        const elements = document.querySelectorAll("tbody > tr > td > div");
        const tokenInfo: any[] = [];
        elements.forEach((element) => {
          const link = element.querySelector("div > h3 > a");
          const name = link?.innerHTML;
          const address = link?.getAttribute("href")?.split("/")[2];
          let symbol = "";
          if (name) {
            const rx = new RegExp(/\((.*?)\)/g);
            const matches = [];
            let match: any;
            while ((match = rx.exec(name)) != null) {
              matches.push(match[1]);
            }
            if (matches.length > 0) {
              symbol = matches.pop();
            }
          }
          if (name && address && symbol) {
            tokenInfo.push({
              name,
              symbol,
              address,
            });
          }
        });

        return tokenInfo;
      });

      contracts = contracts.concat(data);
    }

    try {
      fs.unlinkSync(`contracts/${name}.json`);
    } catch {}
    fs.writeFileSync(`contracts/${name}.json`, JSON.stringify(contracts));

    console.log(`done fetching contracts for ${name}`);
  }

  await browser.close();

  const response = await axios({
    method: "GET",
    url: `https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?CMC_PRO_API_KEY=${process.env.CMC_API_KEY}`,
  });

  console.log(`done fetching cmc map`);

  for (const [target] of targets) {
    const contracts = JSON.parse(
      fs.readFileSync(`contracts/${target}.json`, "utf8")
    );

    for (const contract of contracts) {
      const token = response.data.data
        .filter(
          (x: any) => x.symbol.toLowerCase() === contract.symbol.toLowerCase()
        )
        .sort((a: any, b: any) => a.rank - b.rank)
        .shift();
      if (token) {
        try {
          await downloadFile(
            `https://s2.coinmarketcap.com/static/img/coins/128x128/${token.id}.png`,
            `logos/${contract.symbol.toLowerCase()}.png`
          );
          console.log(`done fetching logo ${contract.symbol.toLowerCase()}`);
        } catch (ex) {
          console.error(ex);
        }
      }
    }
  }
};

const downloadFile = async (fileUrl: string, downloadPath: string) => {
  try {
    const response = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "stream",
    });

    try {
      fs.unlinkSync(downloadPath);
    } catch {}

    response.data.pipe(fs.createWriteStream(downloadPath));
  } catch (err) {
    console.error(err);
    throw err;
  }
};

Exec();
