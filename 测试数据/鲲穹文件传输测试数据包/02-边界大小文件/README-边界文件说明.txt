单文件大小边界测试文件（2026-10-10）

本目录已生成 6 个可直接选择上传的 .bin 文件。
项目界面标记的 500MB = 524288000 字节（500 MiB），5GB = 5368709120 字节（5 GiB）。
每组包含上限前 1 字节、刚好上限、上限后 1 字节。
这些是真实稀疏文件；读出和上传按完整逻辑大小处理，磁盘物理占用较低。
内容是无害识别标记和零填充，只用于大小、上传、扫描链路及下载完整性测试；不用于文档预览或随机数据性能基准。

目录：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件

测试准备：游客单文件限制保持 500MB，游客累计可用量要足够；登录账号可用空间要足够。
容量不足可能先返回配额错误；扫描器不可用可能使发布失败，这些错误不能算单文件大小边界结果。

文件与场景：
TC-04-03-游客单文件边界-500MB减1字节.bin | 524287999 字节 | 游客单文件上限前1字节 | 配额充足时允许上传；发布仍须通过扫描
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-03-游客单文件边界-500MB减1字节.bin
TC-04-01-单文件大小边界-500MB.bin | 524288000 字节 | 游客单文件刚好上限 | 配额充足时允许上传；发布仍须通过扫描
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-01-单文件大小边界-500MB.bin
TC-04-04-游客单文件超限-500MB加1字节.bin | 524288001 字节 | 游客单文件超出上限1字节 | 游客被大小限制拒绝，接口返回413或页面明确提示超限；不创建资源
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-04-游客单文件超限-500MB加1字节.bin
TC-04-05-登录单文件边界-5GB减1字节.bin | 5368709119 字节 | 登录用户单文件上限前1字节 | 登录且账号配额充足时允许分片上传；发布仍须通过扫描
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-05-登录单文件边界-5GB减1字节.bin
TC-04-02-单文件大小边界-5GB.bin | 5368709120 字节 | 登录用户单文件刚好上限 | 登录且账号配额充足时允许分片上传；发布仍须通过扫描
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-02-单文件大小边界-5GB.bin
TC-04-06-登录单文件超限-5GB加1字节.bin | 5368709121 字节 | 登录用户单文件超出上限1字节 | 单文件5GiB限制拒绝，接口返回413或页面明确提示超限；不创建资源
路径：D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\测试数据\鲲穹文件传输测试数据包\02-边界大小文件\TC-04-06-登录单文件超限-5GB加1字节.bin

详细大小、路径、用例和 SHA-256 见本目录的 边界文件清单.csv。
原 Word 文档引用的 TC-04-01 与 TC-04-02 文件名和目录保持一致。
SEND-006 使用三个 500MB 文件逐一测试；SEND-007 使用三个 5GB 文件逐一测试。
上传分片使用前端按文件自动选择的分片大小，不要一次把 5GB 文件发给 chunks 接口。
超出上限的文件应在选择或创建上传会话时被拒绝，不必实际传输全部内容。

生成结果不代表已执行系统用例；执行记录默认未执行。
重新生成缺失文件并校验：
python "D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\scripts\generate-boundary-files.py"
仅校验所有测试数据：
python "D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main\scripts\generate-boundary-files.py" --verify
