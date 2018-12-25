/**
 * @overview
 * @author Steve Xu <stevexugc@gmail.com>
 * @copyright Copyright (c) 2018, Steve Xu
 * @license MIT
 * @preserve
 */
const async = require("async");
const path = require("path");
const COMMON_CONFIG = require("./config.js");
const { log, BaseSpider } = require("./base");
/**
 * 解析列表页,获取种子链接，下载种子文件
 */
class ParseTableList extends BaseSpider {
  constructor(categoryIndex, parseAllCategory, parseListUrl, categoryList) {
    super();
    this.tableList = {}; // 当前分类下的列表页
    this.parseAllCategory = parseAllCategory || false; // 是否解析所有分类
    this.parseListUrl = parseListUrl || ""; //  当前解析的 url
    this.categoryIndex = categoryIndex || 0; // 当前爬取的分类
    this.jsonPath = ""; // 列表页结果路径
    this.currentPage = 1; //当前页数
    this.categoryList = categoryList || {};
    if (this.isEmpty(categoryList)) {
      console.log("分类列表为空,请重新启动!");
      return;
    }
    this.startTimeCount();
    this.recursionExecutive();
  }
  /**
   * 入口
   */
  recursionExecutive() {
    if (this.categoryIndex >= Object.keys(this.categoryList).length) {
      console.log("全部爬取完毕！");
      this.endTimeCount();
      return false;
    }
    let currentCategory = this.getCurrentCategory();
    this.parseListUrl = this.parseListUrl || currentCategory;
    this.jsonPath =
      COMMON_CONFIG.tableList +
      "/" +
      currentCategory.split("?").pop() +
      ".json";
    this.tableList = this.readJsonFile(this.jsonPath) || {};
    this.generateDirectory(this.getParentDirectory());
    this.innerRecursion();
  }

  /**
   * 列表页面请求
   */
  innerRecursion() {
    console.log("爬取列表中...");
    let connectTasks = COMMON_CONFIG.connectTasks;
    let endPage = ~~this.getEndPage();

    let currentPage = this.currentPage;
    if (this.currentPage > endPage) {
      this.endInnerRecursion();
      return false;
    }
    console.log(currentPage);
    let pageLimit = Math.min(endPage, currentPage + connectTasks);
    let requestUrls = [];
    for (let i = currentPage; i <= pageLimit; i++) {
      let requestUrl = COMMON_CONFIG.baseUrl + this.parseListUrl;
      if (i > 1) {
        requestUrl += "&page=" + i;
      }
      requestUrls.push(requestUrl);
    }
    // 并发请求
    async.mapLimit(
      requestUrls,
      COMMON_CONFIG.connectTasks,
      async url => {
        return this.requestPage(url);
      },
      (err, results) => {
        if (err) {
          log(err);
        }
        let detailLinks = [];
        let repeatCount = 0;
        for (let result of results) {
          if (result) {
            let { links, repeat } = this.parseHtml(result);
            repeatCount = repeatCount + ~~repeat;
            detailLinks = [...detailLinks, ...links];
          }
        }
        detailLinks = this.filterRepeat(detailLinks);
        let isRepeat =
          repeatCount >
          (COMMON_CONFIG.connectTasks * COMMON_CONFIG.pageSize) / 2;
        this.getDetailPage(detailLinks, isRepeat);
      }
    );
  }
  /**
   * 请求详情页面
   * async 配合 await 会将同步变成异步过程
   * @param {Array} detailLinks 详情页面链接
   */
  async getDetailPage(detailLinks, isRepeat) {
    console.log("爬取种子中...");
    let tableList = this.tableList;
    for (let link of detailLinks) {
      // 详情页已经爬取了,直接下载种子
      if (tableList[link] && tableList[link].title) {
        let directory =
          this.getParentDirectory() +
          "/" +
          this.filterIllegalPath(tableList[link].title);
        await this.downloadResult(
          directory,
          tableList[link].torrents,
          tableList[link].images
        );
      } else {
        let $ = await this.requestPage(COMMON_CONFIG.baseUrl + link);
        await this.parseDetailHtml($, link);
      }
    }
    this.endDetailRecursion(isRepeat);
  }
  isParentCategory() {
    let lists = Object.keys(this.categoryList);
    return lists.includes(this.parseListUrl);
  }
  /**
   * 获取列表页面的结束页面
   */
  getEndPage() {
    let currentCategory = this.getCurrentCategory();
    if (this.isParentCategory()) {
      return this.categoryList[currentCategory].endPage;
    } else {
      let childCategory = this.categoryList[currentCategory].childCategory;
      let item = childCategory.find(item => item.link === this.parseListUrl);
      return Math.min(item.endPage, COMMON_CONFIG.connectTasks);
    }
  }
  /**
   * 获取父文件夹路径
   *
   */
  getParentDirectory() {
    let temp = "";
    let currentCategory = this.getCurrentCategory();
    if (!this.isParentCategory()) {
      let childCategory = this.categoryList[currentCategory].childCategory;
      let item =
        childCategory.find(item => item.link === this.parseListUrl) || {};
      temp = "_" + item.title;
    }
    return (
      COMMON_CONFIG.result +
      "/" +
      this.categoryList[currentCategory].title +
      temp
    );
  }
  /**
   * 结束详情页递归
   * @param {Boolean} isRepeat 是否重复
   */
  endDetailRecursion(isRepeat) {
    this.currentPage += COMMON_CONFIG.connectTasks;
    if (isRepeat) {
      this.currentPage = COMMON_CONFIG.connectTasks + this.getTotalCount();
    }
    this.innerRecursion();
  }
  /**
   * 获取已经爬取的页数
   */
  getTotalCount() {
    let totalLen = 0;
    let tableList = this.tableList;
    if (!this.isParentCategory()) {
      for (let key in tableList) {
        if (tableList[key].category === this.parseListUrl) {
          totalLen++;
        }
      }
      console.log("根据已有数据更新页数", totalLen);
    } else {
      totalLen = Object.keys(tableList).length;
    }
    return Math.ceil(totalLen / COMMON_CONFIG.pageSize);
  }
  /**
   * 获取当前的分类
   */
  getCurrentCategory() {
    return Object.keys(this.categoryList)[this.categoryIndex];
  }
  /**
   * 判断是否爬取所有分类的列表页面
   */
  endInnerRecursion() {
    if (this.parseAllCategory) {
      this.currentPage = 1;
      this.categoryIndex++;
      this.parseListUrl = this.getCurrentCategory();
      this.recursionExecutive();
    } else {
      console.log("爬取完毕！");
      this.endTimeCount();
    }
  }
  /**
   * 解析列表页面
   * @param {Object} $   cheerio 对象
   */
  parseHtml($) {
    let trDoms = $("#ajaxtable tr");
    let detailLinks = [];
    let repeatCount = 0;
    let tableList = this.tableList;
    let category = this.parseListUrl;
    let isParentCategory = this.isParentCategory();
    let currentCategory = this.getCurrentCategory();
    trDoms.each(function() {
      // 详情页面链接
      let link = $(this)
        .find("h3")
        .eq(0)
        .find("a")
        .attr("href");
      if (link && tableList[link]) {
        repeatCount++;
      }
      if (link) {
        detailLinks.push(link);
        tableList[link] = {
          category: isParentCategory ? currentCategory : category, // 分类
          images: [],
          torrents: []
        };
      }
    });
    this.updateTableList();
    return {
      links: detailLinks,
      repeat: repeatCount === trDoms.length
    };
  }
  /**
   * 解析详情页面
   * @param {Object} $ cheerio 对象
   * @param {String} seed  详情页链接
   */
  async parseDetailHtml($, seed) {
    if (!$) {
      return;
    }
    let torrents = [];
    /**
     * 获取页面上的每一个链接
     * 不放过任何一个种子，是不是很贴心！！
     */
    $("body a").each(function() {
      let href = $(this).attr("href");
      if (href && COMMON_CONFIG.seedSite.some(item => href.includes(item))) {
        torrents.push(href);
      }
    });
    // 去重
    torrents = this.filterRepeat(torrents);
    let images = [];
    $("#td_tpc img").each(function() {
      let src = $(this).attr("src");
      let extName = path.extname(src);
      const extList = [".jpg", ".png", ".jpeg", ".gif", ".bmp"];
      // 去掉无效的图片下载链接
      if (src && src.startsWith("http") && extList.includes(extName)) {
        images.push(src);
      }
    });
    images = this.filterRepeat(images);
    // title 字段非空，可以在下次不用爬取该页面，直接下载种子文件
    let title =
      $("#td_tpc h1")
        .eq(0)
        .text() || "已经爬取了该详情页" + ~~(Math.random() * 1e5);
    // 存放爬取结果，下次直接下载种子文件
    let tableList = this.tableList;
    tableList[seed] = Object.assign(tableList[seed], {
      title,
      torrents,
      images
    });
    this.updateTableList();
    let directory =
      this.getParentDirectory() + "/" + this.filterIllegalPath(title);
    await this.downloadResult(directory, torrents, images);
  }
  /**
   * 更新列表数据
   */
  updateTableList() {
    this.updateJsonFile(this.tableList, this.jsonPath, false);
  }
}
module.exports = {
  ParseTableList
};