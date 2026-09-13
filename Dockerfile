# 1. Base Image nhẹ (Alpine giúp container khởi động nhanh, ít tốn RAM nền)
FROM node:20-alpine

# 2. Tạo thư mục làm việc trong container
WORKDIR /app

# 3. Copy file quản lý thư viện và cài đặt (Tối ưu hóa Docker Cache)
COPY package*.json ./
RUN npm ci --only=production

# 4. Copy toàn bộ mã nguồn ứng dụng vào container
COPY . .

# 5. Mở port ứng dụng (mặc định 3000)
EXPOSE 3000

# 6. Lệnh chạy app
CMD ["node", "src/app.js"]