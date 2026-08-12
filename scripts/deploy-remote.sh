#!/bin/sh
set -eu

STAGE_DIR="${1:?缺少暂存目录}"
ARCHIVE="${2:?缺少上传包路径}"
TARGET_DIR="/home/ubuntu/Code-World"
PROJECT_NAME="code-world"
ROLLBACK_IMAGE="code-world:rollback"

case "$STAGE_DIR" in
  /home/ubuntu/.code-world-stage-*) ;;
  *) echo "拒绝使用不安全的暂存目录：$STAGE_DIR" >&2; exit 1 ;;
esac

case "$ARCHIVE" in
  /home/ubuntu/.code-world-*.tar.gz) ;;
  *) echo "拒绝使用不安全的上传包路径：$ARCHIVE" >&2; exit 1 ;;
esac

cleanup() {
  cd /home/ubuntu
  rm -f -- "$ARCHIVE"
  rm -rf -- "$STAGE_DIR"
}
trap cleanup EXIT

test -f "$STAGE_DIR/Dockerfile"
test -f "$STAGE_DIR/compose.yaml"
test -f "$STAGE_DIR/package.json"

previous_image="$(sudo docker image inspect code-world:latest --format '{{.Id}}' 2>/dev/null || true)"
if [ -n "$previous_image" ]; then
  sudo docker tag "$previous_image" "$ROLLBACK_IMAGE"
fi

echo "[远端] 构建新镜像..."
cd "$STAGE_DIR"
sudo docker compose -p "$PROJECT_NAME" build

echo "[远端] 同步部署文件..."
mkdir -p "$TARGET_DIR"
rsync -a --delete "$STAGE_DIR/" "$TARGET_DIR/"

echo "[远端] 切换容器..."
cd "$TARGET_DIR"
if ! sudo docker compose -p "$PROJECT_NAME" up -d --no-build --remove-orphans; then
  if [ -n "$previous_image" ]; then
    sudo docker tag "$ROLLBACK_IMAGE" code-world:latest
    sudo docker compose -p "$PROJECT_NAME" up -d --force-recreate --no-build
  fi
  exit 1
fi

echo "[远端] 等待健康检查..."
healthy=false
attempt=1
while [ "$attempt" -le 30 ]; do
  status="$(sudo docker inspect code-world --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  if [ "$status" = "healthy" ] && curl -fsS --max-time 5 http://127.0.0.1:8787/healthz >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [ "$healthy" != "true" ]; then
  echo "新容器未通过健康检查，正在恢复上一镜像..." >&2
  sudo docker logs --tail 80 code-world >&2 || true
  if [ -n "$previous_image" ]; then
    sudo docker tag "$ROLLBACK_IMAGE" code-world:latest
    sudo docker compose -p "$PROJECT_NAME" up -d --force-recreate --no-build
  fi
  exit 1
fi

if [ -n "$previous_image" ]; then
  sudo docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
fi

echo "[远端] 容器健康，部署成功。"
