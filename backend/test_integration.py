import os
import sys

# 确保导入路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_full_flow():
    print("--- 1. 测试服务健康检查 ---")
    res = client.get("/api/health")
    assert res.status_code == 200, res.text
    print("✓ 健康检查通过:", res.json())

    print("\n--- 2. 测试员工账号注册 ---")
    username = "test_employee_1"
    res = client.post("/api/auth/register", json={
        "username": username,
        "password": "password123",
        "display_name": "测试专员小李"
    })
    if res.status_code == 400 and "已存在" in res.text:
        # 已存在则直接登录
        res = client.post("/api/auth/login", json={
            "username": username,
            "password": "password123"
        })
    assert res.status_code == 200, res.text
    data = res.json()
    token = data["access_token"]
    print("✓ 员工注册/登录成功，获取 JWT Token")

    headers = {"Authorization": f"Bearer {token}"}

    print("\n--- 3. 测试获取当前员工信息 ---")
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    print("✓ 当前员工信息:", res.json())

    print("\n--- 4. 测试获取主流邮箱服务商预设 ---")
    res = client.get("/api/accounts/presets", headers=headers)
    assert res.status_code == 200
    presets = res.json()
    assert "aliyun_enterprise" in presets
    assert "qq" in presets
    assert "163" in presets
    print(f"✓ 获取到 {len(presets)} 个邮箱预设: {list(presets.keys())}")

    print("\n--- 5. 测试邮件列表获取 ---")
    res = client.get("/api/emails", headers=headers)
    assert res.status_code == 200
    print("✓ 邮件列表查询成功，当前邮件数:", res.json()["total"])

    print("\n--- 6. 测试前端静态托管路由 ---")
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers.get("content-type", "")
    print("✓ 前端静态 SPA 页面托管正常，返回 HTML 长度:", len(res.text))

    print("\n🎉 全部后端核心接口与前端静态挂载集成测试通过！")

if __name__ == "__main__":
    test_full_flow()
