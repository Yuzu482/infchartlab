# 难度细分值调查（2026-10-05）

## 结论与范围

在本地已检查版本中，尚未找到可确认的逐谱面小数隐藏难度定数。
这是一项有限范围的静态调查，不能等同于证明整个程序不存在其他细分值。
本报告不把未知浮点数或战斗参数解释成谱面定数。

## 已确认的资源证据

- `SongData.asset` 的 `SongChartInfo` 有 `int Rating` 与字符串
  `LevelSectionIndicator`，没有额外浮点难度字段。
- 检查的 300 条可用谱面记录中，内部整数 Rating 与等级字符串一致。
  另外 12 条教程/空槽记录为 Rating 0 与显示 `?`。
- 当前安装的 SongData bundle 哈希与已解析 checkpoint 一致。
- GameData、DynamicStringMapping、StoryDetails 的已解析结构经输入哈希核对，
  没有发现逐谱面小数定数表。GameData 的 BasePower/BaseFortitude 属于卡牌属性。
- 直接只读解析 rainshower0/1/2/3：Rating 分别 4/7/10/13；
  SPC 头部浮点数均为 174.0 与 4.0。前者为基础 BPM；后者含义未确认，
  该样本不支持将其解释为逐难度细分定数。解析前后输入哈希一致。

## 新增程序证据

- `BattleScore` 存在 `DifficultyRatingD`，但名称本身不是隐藏定数证据。
- 通过元数据字段类型索引找到 `_K._Uh` 持有 BattleScore 的 `_MCb` 字段。
- 其构造函数 RVA `0x4b08c0` 初始化内嵌的 56 字节评分记录。
  RVA `0x4b0b01` 至 `0x4b0b49` 的写入序列将对应 DifficultyRatingD
  的槽位设为常量 1.0，TypeModifier 则依据模式选择 1.0 或 0.5。
  此初始化路径没有读取逐谱面小数难度。
- BattleScore 的序列化函数复制 56 字节，评分 getter 中存在双精度运算。
  使用双精度不等于保存了独立的小数谱面定数。

程序静态检查使用 metadata v39；GameAssembly SHA-256：
`0d4d339b050188cbd53922ee0204105ca71305abfb73bcfdb994affe1b33e70c`；
metadata SHA-256：
`b3fccad7cb85f61e1e01cac8ff22e9878a0276b7349c42881caeb567c767ef83`。
检查时本地二进制副本与安装文件哈希一致，未执行游戏二进制。

## 未解决事项

尚未完整证明 DifficultyRatingD 的所有后续赋值路径，也未穷尽混淆代码、
整数缩放、运行时计算或未来版本的其他资源。此前只读调查工作器没有
反汇编执行工具，其结果不计作已完成的原生代码验证；上述地址检查由主机
现有静态工具与 objdump 实际执行。

因此目前可以公布整数内部评级，不能自行补成 13.2、13.7 等数值。
