import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app
from app.core.database import SessionLocal
from app.models.user import User
from app.core.security import create_access_token

client = TestClient(app)

def test_dingtalk_permission_and_admin():
    db = SessionLocal()
    try:
        # 清理旧的测试用户
        db.query(User).filter(User.username.like("test_dd_%")).delete()
        db.commit()

        # 1. 测试未授权用户访问被阻断 (403 Forbidden)
        unauth_user = User(
            username="test_dd_unauth",
            hashed_password="xxx",
            display_name="未授权测试员工",
            dingtalk_userid="dd_unauth_001",
            is_admin=False,
            is_active=False
        )
        db.add(unauth_user)
        db.commit()
        db.refresh(unauth_user)

        unauth_token = create_access_token(subject=unauth_user.id)
        res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {unauth_token}"})
        assert res.status_code == 403, f"未开通权限的员工未被阻断: {res.text}"
        print("✓ 权限准入拦截测试通过：未授权员工访问返回 403 并阻断")

        # 2. 测试已开通权限的管理员
        admin_user = User(
            username="test_dd_admin",
            hashed_password="xxx",
            display_name="测试管理员",
            dingtalk_userid="dd_admin_001",
            is_admin=True,
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)

        admin_token = create_access_token(subject=admin_user.id)
        res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["is_admin"] is True
        assert data["is_active"] is True
        print("✓ 管理员身份验证通过:", data["display_name"], "is_admin =", data["is_admin"])

        # 3. 测试管理员查询员工目录
        res = client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        assert res.status_code == 200, res.text
        user_list = res.json()
        assert len(user_list) >= 2
        print(f"✓ 管理后台员工目录查询成功，当前目录共计 {len(user_list)} 人")

        # 4. 测试管理员为未授权员工开通使用权限
        res = client.put(
            f"/api/admin/users/{unauth_user.id}/access",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_active": True}
        )
        assert res.status_code == 200, res.text
        assert res.json()["is_active"] is True
        print(f"✓ 权限开通测试通过：已为员工【{unauth_user.display_name}】开通系统使用权限")

        # 5. 验证开通后该员工可正常登录与访问
        res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {unauth_token}"})
        assert res.status_code == 200, res.text
        print("✓ 开通后员工访问验证成功:", res.json()["display_name"])

        # 6. 测试普通员工尝试访问管理后台被拒
        res = client.get("/api/admin/users", headers={"Authorization": f"Bearer {unauth_token}"})
        assert res.status_code == 403, f"普通员工未被拦截访问管理后台: {res.text}"
        print("✓ 管理员鉴权测试通过：普通员工尝试访问管理接口被 403 拦截")

        # 7. 测试防误操作保护：当前管理员不能关闭自己的权限
        res = client.put(
            f"/api/admin/users/{admin_user.id}/access",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_active": False}
        )
        assert res.status_code == 400, "管理员成功关闭了自己的权限（缺少保护）"
        print("✓ 安全保护测试通过：管理员不可关闭自己的系统使用权限")

        # 清理测试数据
        db.query(User).filter(User.username.like("test_dd_%")).delete()
        db.commit()

        print("\n🎉 钉钉登录鉴权、权限准入拦截、管理员授权与安全机制全部验证通过！")
    finally:
        db.close()

if __name__ == "__main__":
    test_dingtalk_permission_and_admin()
