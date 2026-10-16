// 签名等价性校验：对比补丁进程与原始进程的代码签名校验表现。
// 用法：xcrun swift check-sig.swift <pid>
import Security
import Foundation

let pid = pid_t(Int32(CommandLine.arguments[1])!)
var code: SecCode?
let guestStatus = SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: pid] as CFDictionary, [], &code)
guard guestStatus == errSecSuccess, let code else { print("guest-error:\(guestStatus)"); exit(2) }
let reqString = "anchor apple generic and identifier \"dev.zcode.app\" and certificate leaf[subject.OU] = \"8A5X4JJ39T\""
var requirement: SecRequirement?
_ = SecRequirementCreateWithString(reqString as! CFString, [], &requirement)
func probe(_ name: String, _ flags: SecCSFlags) {
    let s = SecCodeCheckValidity(code, flags, requirement)
    print("process/\(name): \(s == errSecSuccess ? "PASS" : "FAIL(\(s))")")
}
probe("默认", [])
probe("全架构", SecCSFlags(rawValue: 1 << 0))
probe("严格", SecCSFlags(rawValue: 1 << 5))
probe("严格+全架构", SecCSFlags(rawValue: (1 << 0) | (1 << 5)))
