# VocabMaster IELTS — trạng thái triển khai và hướng dẫn

Trang web đã được đưa lên GitHub Pages: https://l2practice.github.io/test-simu/ . Mã nguồn nằm tại https://github.com/l2practice/test-simu . Đề **Chờ kiểm tra** vẫn hiện trong Library; SV có thể làm thử và báo câu sai để GV chỉnh.

## Đã triển khai

- Repo `l2practice/test-simu` trên nhánh `main`; GitHub Pages đang phục vụ trang tại link ở trên.
- Firebase project riêng `test-simulation-4dc1b`: Firestore rules đã Publish; Email/Password bật; domain `l2practice.github.io` đã thêm; ba composite indexes đều **Enabled**.
- Apps Script tại link bạn gửi đã được cập nhật lên **Version 2**, giữ nguyên `/exec` URL và quyền hiện có. Code gồm router IELTS import/chấm điểm và Firebase auth helpers.
- Đã chạy `vmfb_0_TestConnection`: Firestore admin, Firebase Auth admin, Google Sheet và Mail đều **OK**.

## Bắt đầu dùng

1. Mở [trang Test Simu](https://l2practice.github.io/test-simu/).
2. Tạo tài khoản giáo viên trên trang đăng ký / nút đăng nhập giáo viên.
3. Đăng nhập GV, tạo lớp; sau đó SV đăng ký với mã lớp.
4. GV tạo đề IELTS Reading/Listening và chọn lớp. Đề **Chờ kiểm tra** vẫn hiện cho SV làm; các báo cáo câu sai xuất hiện cho GV chỉnh.

Firestore hiện chưa có dữ liệu lớp, tài khoản GV/SV hoặc đề. Chưa có bài làm thật để xác minh luồng SV nộp bài đến Results; deployment và kiểm tra kết nối GAS đã hoàn tất.

## Audio Listening (tùy chọn)

Firebase Console hiện báo Storage cần nâng cấp từ Spark lên Blaze. Nếu bạn muốn cho phép tải audio lên Firebase Storage, chủ dự án cần nâng cấp gói, tạo bucket rồi Publish `storage.rules`. Mình chưa thay đổi gói thanh toán. Phần Reading và các chức năng IELTS khác không cần bật Storage.

## Cập nhật mã bằng gói ZIP

Gói chỉ chứa các file đã thêm/sửa. Thay các file cùng tên trong repo, thêm `ielts.html`, `firestore.indexes.json`, `storage.rules` và thư mục `tests/`. Giữ các file cũ như `index.html`, `login.html`, `signup.html`, `vm-theme.css`, `vm-cefr.js`, `cefr-dict.js`.

Firebase Web API key trong `vm-common.js` là client config công khai. Không commit service account key, Firebase Admin key hoặc mật khẩu.
