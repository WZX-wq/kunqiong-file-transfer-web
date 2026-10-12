"""补齐现有测试数据包的大小边界文件；保留已有测试文件和执行记录。"""
import argparse
import csv
import ctypes
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "测试数据" / "鲲穹文件传输测试数据包"
DIRECTORY = DATA_ROOT / "02-边界大小文件"
SPEC_PATH = DIRECTORY / "边界文件规格.json"
TAIL = b"KQFT-BOUNDARY-END\n"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def allocated_bytes(path):
    if os.name != "nt":
        return path.stat().st_blocks * 512
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCompressedFileSizeW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel.GetCompressedFileSizeW.restype = ctypes.c_ulong
    high = ctypes.c_ulong()
    ctypes.set_last_error(0)
    low = kernel.GetCompressedFileSizeW(str(path), ctypes.byref(high))
    if low == 0xFFFFFFFF and ctypes.get_last_error():
        raise ctypes.WinError(ctypes.get_last_error())
    return (high.value << 32) | low


def marker(fixture):
    return f"KQFT-BOUNDARY-TEST\n{fixture['path']}\nbytes={fixture['bytes']}\n".encode("utf-8")


def ensure_sparse_hole(stream, fixture):
    if os.name != "nt":
        return
    import msvcrt
    class ZeroRange(ctypes.Structure):
        _fields_ = [("start", ctypes.c_longlong), ("end", ctypes.c_longlong)]
    stream.flush()
    zero_range = ZeroRange(len(marker(fixture)), fixture["bytes"] - len(TAIL))
    returned = ctypes.c_ulong()
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    ok = kernel.DeviceIoControl(ctypes.c_void_p(msvcrt.get_osfhandle(stream.fileno())),
                               0x980C8, ctypes.byref(zero_range), ctypes.sizeof(zero_range),
                               None, 0, ctypes.byref(returned), None)
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())


def create_file(fixture):
    target = DIRECTORY / fixture["path"]
    if target.exists():
        verified = verify_file(fixture)
        manifest = json.loads((DATA_ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
        saved = next((item for item in manifest["files"] if item["path"] == verified["path"]), None)
        if not saved or saved.get("sha256") != verified["sha256"]:
            raise ValueError(f"已有文件内容与生成清单不一致，保留原文件：{target}")
        with target.open("r+b") as stream:
            ensure_sparse_hole(stream, fixture)
        return target
    with target.open("xb") as stream:
        if os.name == "nt":
            import msvcrt
            returned = ctypes.c_ulong()
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            ok = kernel.DeviceIoControl(ctypes.c_void_p(msvcrt.get_osfhandle(stream.fileno())),
                                       0x900C4, None, 0, None, 0, ctypes.byref(returned), None)
            if not ok:
                raise ctypes.WinError(ctypes.get_last_error())
        stream.truncate(fixture["bytes"])
        stream.seek(0)
        stream.write(marker(fixture))
        stream.seek(fixture["bytes"] - len(TAIL))
        stream.write(TAIL)
        ensure_sparse_hole(stream, fixture)
    return target


def verify_file(fixture):
    target = DIRECTORY / fixture["path"]
    if target.stat().st_size != fixture["bytes"]:
        raise ValueError(f"大小不匹配，保留原文件：{target}")
    with target.open("rb") as stream:
        if stream.read(len(marker(fixture))) != marker(fixture):
            raise ValueError(f"头部标记不匹配，保留原文件：{target}")
        stream.seek(fixture["bytes"] // 2)
        if stream.read(4096) != b"\0" * 4096:
            raise ValueError(f"中间内容不匹配：{target}")
        stream.seek(-len(TAIL), os.SEEK_END)
        if stream.read() != TAIL:
            raise ValueError(f"尾部标记不匹配：{target}")
    return {"path": target.relative_to(DATA_ROOT).as_posix(), "absolutePath": str(target),
            "bytes": target.stat().st_size, "allocatedBytes": allocated_bytes(target),
            "sparse": True, "sha256": sha256(target), "caseIds": fixture["case_ids"],
            "scenario": fixture["scenario"], "expected": fixture["expected"]}


def update_indexes(spec, entries):
    index = DIRECTORY / "边界文件清单.csv"
    with index.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["文件名", "准确字节数", "物理占用字节数", "对应原文档用例", "场景", "预期结果", "绝对路径", "SHA256", "执行状态"])
        for entry in entries:
            writer.writerow([Path(entry["path"]).name, entry["bytes"], entry["allocatedBytes"],
                             "/".join(entry["caseIds"]), entry["scenario"], entry["expected"],
                             entry["absolutePath"], entry["sha256"], "未执行"])
    lines = ["单文件大小边界测试文件（2026-10-10）", "",
             "本目录已生成 6 个可直接选择上传的 .bin 文件。",
             "项目界面标记的 500MB = 524288000 字节（500 MiB），5GB = 5368709120 字节（5 GiB）。",
             "每组包含上限前 1 字节、刚好上限、上限后 1 字节。",
             "这些是真实稀疏文件；读出和上传按完整逻辑大小处理，磁盘物理占用较低。",
             "内容是无害识别标记和零填充，只用于大小、上传、扫描链路及下载完整性测试；不用于文档预览或随机数据性能基准。",
             "", "目录：" + str(DIRECTORY), "",
             "测试准备：游客单文件限制保持 500MB，游客累计可用量要足够；登录账号可用空间要足够。",
             "容量不足可能先返回配额错误；扫描器不可用可能使发布失败，这些错误不能算单文件大小边界结果。",
             "", "文件与场景："]
    for entry in entries:
        lines.extend([f"{Path(entry['path']).name} | {entry['bytes']} 字节 | {entry['scenario']} | {entry['expected']}",
                      "路径：" + entry["absolutePath"]])
    lines.extend(["", "详细大小、路径、用例和 SHA-256 见本目录的 边界文件清单.csv。",
                  "原 Word 文档引用的 TC-04-01 与 TC-04-02 文件名和目录保持一致。",
                  "SEND-006 使用三个 500MB 文件逐一测试；SEND-007 使用三个 5GB 文件逐一测试。",
                  "上传分片使用前端按文件自动选择的分片大小，不要一次把 5GB 文件发给 chunks 接口。",
                  "超出上限的文件应在选择或创建上传会话时被拒绝，不必实际传输全部内容。",
                  "", "生成结果不代表已执行系统用例；执行记录默认未执行。",
                  "重新生成缺失文件并校验：", f'python "{Path(__file__).resolve()}"',
                  "仅校验所有测试数据：", f'python "{Path(__file__).resolve()}" --verify'])
    (DIRECTORY / "README-边界文件说明.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    readme = DATA_ROOT / "README-文件名对应测试场景.txt"
    text = readme.read_text(encoding="utf-8-sig")
    text = text.replace("TC-04：单文件 500MB/5GB 大小边界", "TC-04：单文件 500MB/5GB 大小边界，各包含上限减1字节、上限、上限加1字节，共6个真实文件")
    text = text.replace("TC-04 的 500MB 和 5GB 文件是稀疏文件，逻辑大小正确但物理占用较低。轻量 ZIP 不包含这两个边界文件。",
                        "TC-04 的6个边界文件已保存在 02-边界大小文件 目录，均为稀疏文件，逻辑大小精确，上传时按完整大小处理。原轻量 ZIP 不含这些大文件，请从本目录选择。")
    readme.write_text(text, encoding="utf-8")
    manifest_path = DATA_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    manifest["boundaryFiles"] = entries
    manifest["boundaryFilesUpdatedAt"] = datetime.now().astimezone().isoformat()
    manifest["quantities"]["boundaryFiles"] = len(entries)
    replacements = {entry["path"]: entry for entry in entries}
    for target in [SPEC_PATH, index, DIRECTORY / "README-边界文件说明.txt", readme]:
        relative = target.relative_to(DATA_ROOT).as_posix()
        replacements[relative] = {"path": relative, "bytes": target.stat().st_size, "sha256": sha256(target)}
    manifest["files"] = [replacements.pop(item["path"], item) for item in manifest["files"]]
    manifest["files"].extend(replacements.values())
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify_manifest():
    manifest = json.loads((DATA_ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    for item in manifest["files"]:
        target = DATA_ROOT / item["path"]
        if not target.is_file() or target.stat().st_size != item["bytes"]:
            raise ValueError(f"清单文件缺失或大小错误：{target}")
        if item.get("sha256") and sha256(target) != item["sha256"]:
            raise ValueError(f"SHA-256 不匹配：{target}")
    print(f"完整测试数据清单校验通过：{len(manifest['files'])} 个文件；路径、大小、SHA-256 一致。", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8-sig"))
    total = sum(item["bytes"] for item in spec["fixtures"])
    if total != spec["logical_bytes_budget"]:
        raise ValueError("规格逻辑字节预算与文件总大小不一致")
    if args.verify:
        verify_manifest()
        for fixture in spec["fixtures"]:
            verify_file(fixture)
        return
    entries = []
    for fixture in spec["fixtures"]:
        path = create_file(fixture)
        print(f"核验并计算 SHA-256：{path.name} | {fixture['bytes']} 字节", flush=True)
        entries.append(verify_file(fixture))
    update_indexes(spec, entries)
    print(f"已补齐 {len(entries)} 个边界文件，总逻辑大小 {total} 字节，总物理占用 {sum(e['allocatedBytes'] for e in entries)} 字节。", flush=True)
    verify_manifest()


if __name__ == "__main__":
    main()
