import puppeteer from "puppeteer";
import dotenv from "dotenv";
import FormData from "form-data";
import { getCwMessage, postCwFile, CwMessage } from "./helpers/cwHelper";
import { GoogleSpreadsheet, ServiceAccountCredentials } from "google-spreadsheet";
import path from "path";

type TargetMessage = {
  url: string;
};

type LighthouseContent = {
  url: string;
  performanceRate: string;
  accessibilityRate: string;
  bestPracticesRate: string;
  seoRate: string;
  html: string;
};

dotenv.config();

(async () => {
  /*
   * チャットワークのメッセージから「それは、」で始まるテキストが見つかるまで、
   * 「性能　教えて」というテキストのあるかつ対象のユーザへの返信があるメッセージを検索し、
   * その中のURLを取得します。
   * ↓こんなメッセージを想定しています。
   * [To:・・・] 性能を教えて　https://furunavi.jp/　https://furunavi.jp/catalog/
   */
  const getTargetMessageListFromCw = async (cwKey: string, cwRoomId: string, userId: string): Promise<TargetMessage[]> => {
    const list = await getCwMessage<TargetMessage[]>(cwKey, cwRoomId, (data: CwMessage[]) => {
      const isTarget = (v: string) => v.match(/性能/) && v.match(/教えて/) && v.match(new RegExp(userId));
      const urlRegExp = new RegExp("http(s)?://([\\w-]+\\.)+[\\w-]+(/[\\w-./?%&=,]*)?", "g");
      const messageList = data.reverse();
      return messageList
        .slice(messageList.findIndex((v) => v.body.startsWith("それは、")))
        .filter((v) => isTarget(v.body))
        .map((v) => v.body.match(urlRegExp))
        .reduce((acc, val) => acc.concat(val), []) // 多重配列のフラット化
        .map((url) => ({ url }));
    });
    return list;
  };

  /*
   * Lighthouse（https://web.dev/measure/）にアクセスし、
   * 指定されたURLで検索し結果を取得します。
   * puppeteerを利用しています。
   * ・評価したいURLを入力
   * ・RUN AUDITボタンをクリック
   * ・終わるまで待機（ボタンがdisabledの間は待機）
   * ・View Reportをクリック
   * ・別タブが開くのでタブ移動
   * ・必要な値を取得
   */
  const accessLighthouse = async (url: string): Promise<LighthouseContent> => {
    const browser = await puppeteer.launch();
    try {
      const page = await browser.newPage();
      await page.goto("https://web.dev/measure/");
      await page.waitForSelector("input.lh-input");
      await page.type("input.lh-input", url);
      await page.click("button.web-snackbar__action");
      await page.click("button#run-lh-button");
      await page.waitForSelector("button#run-lh-button:not([disabled])", { timeout: 180000 });
      await page.click("a.viewreport");
      const [newPage] = await Promise.all([browser.waitForTarget((t) => t.opener() === page.target()).then((t) => t.page()), page.click("a.viewreport")]);
      await newPage.waitForSelector("a[href='#performance']");
      const performanceRate = await newPage.$eval("a[href='#performance'] div.lh-gauge__percentage", (el) => el.innerHTML);
      const accessibilityRate = await newPage.$eval("a[href='#accessibility'] div.lh-gauge__percentage", (el) => el.innerHTML);
      const bestPracticesRate = await newPage.$eval("a[href='#best-practices'] div.lh-gauge__percentage", (el) => el.innerHTML);
      const seoRate = await newPage.$eval("a[href='#seo'] div.lh-gauge__percentage", (el) => el.innerHTML);
      const html = await newPage.evaluate(() => document.documentElement.outerHTML);

      return { url, performanceRate, accessibilityRate, bestPracticesRate, seoRate, html };
    } catch (e) {
      console.log(e);
      throw e;
    } finally {
      await browser.close();
    }
  };

  /*
   * チャットワークに通知します。
   * テキストとファイルを送信します。
   * テキストの最初に「それは」をつけます。
   */
  const sendCw = async (cwKey: string, cwRoomId: string, light: LighthouseContent): Promise<void> => {
    const fileName = `${light.url.replace(/[/]|[?]|[:]|[,]/g, "")}.html`;
    const data = new FormData();
    data.append("file", light.html ?? "", fileName);
    data.append("message", `それは、\nTarget URL：${light.url}\nPerformance：${light.performanceRate}\nAccessibility：${light.accessibilityRate}\nBest Practices：${light.bestPracticesRate}\nSEO：${light.seoRate}`);
    await postCwFile(cwKey, cwRoomId, data);
  };

  /*
   * SpreadSheetに出力します。
   */
  const writeSpreadSheet = async (spreadSheetId: string, lightList: LighthouseContent[]): Promise<void> => {
    const doc = new GoogleSpreadsheet(spreadSheetId);
    const credential = require(path.resolve(__dirname, "credentials.json")) as ServiceAccountCredentials;
    await doc.useServiceAccountAuth(credential);
    await doc.loadInfo();

    const shiftSheet = doc.sheetsById[0];
    const today = new Date();
    const todayText = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
    for (const content of lightList) {
      await shiftSheet.addRow({
        Date: todayText,
        URL: content.url,
        PerformanceRate: content.performanceRate,
        AccessibilityRate: content.accessibilityRate,
        BestPracticesRate: content.bestPracticesRate,
        SeoRate: content.seoRate,
      });
    }
  };

  // --------------------------- //

  const cwKey = process.env.CW_KEY ?? "";
  const cwRoomId = process.env.CW_ROOM_ID ?? "";
  const cwUserId = process.env.CW_USER_ID ?? "";
  const spreadSheetId = process.env.SPREADSHEET_ID ?? "";

  const targetMessageList = await getTargetMessageListFromCw(cwKey, cwRoomId, cwUserId);

  const lighthouseList = await Promise.all(
    targetMessageList.map(async (message) => {
      const lighthouseContent = await accessLighthouse(message.url);
      await sendCw(cwKey, cwRoomId, lighthouseContent);
      return lighthouseContent;
    })
  );

  if (lighthouseList.length) {
    await writeSpreadSheet(spreadSheetId, lighthouseList);
  }
})();
