// cloudfunctions/initParks/seed.js —— owner: T7
//
// 公园种子数据。改坐标 / 半径直接改这里再重新部署(README「手动验证」第 4 条)。
//
// 这个文件是**纯数据**:不 require 任何东西,包括 _shared。
// scripts/deploy-shared.js 只重写 core.js / index.js 里的 '../_shared/x',
// 这里要是写了跨目录 require,部署到云上就 resolve 不到(spec 3.3.1)。
//
// _id 写死是故意的:重复部署 / 重复导入都落在同一批文档上,不会变出第二套公园。

/** @type {Array<{_id:string,name:string,latitude:number,longitude:number,radiusM:number,active:boolean}>} */
const PARKS = [
  { _id: 'park_liulang', name: '西湖·柳浪闻莺', latitude: 30.2415, longitude: 120.156, radiusM: 300, active: true },
  { _id: 'park_yangtai', name: '钱江新城·城市阳台', latitude: 30.244, longitude: 120.214, radiusM: 250, active: true },
  { _id: 'park_xixi', name: '西溪湿地·福堤', latitude: 30.268, longitude: 120.065, radiusM: 400, active: true },
];

module.exports = { PARKS };
