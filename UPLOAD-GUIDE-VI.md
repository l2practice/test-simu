# VocabMaster IELTS — trạng thái triển khai và hướng dẫn

Trang web đã được đưa lên GitHub Pages: https://l2practice.github.io/test-simu/ . Mã nguồn nằm tại https://github.com/l2practice/test-simu . Các bài ở trạng thái **Chờ kiểm tra** vẫn hiện trong Library; SV làm thử và báo câu sai để GV chỉnh.

## Đã làm

- Đã tạo repo `l2practice/test-simu`, đưa mã nguồn lên nhánh `main`, bật GitHub Pages.
- Trang đăng nhập mở được tại `https://l2practice.github.io/test-simu/login.html`.
- Firebase project `test-simulation-4dc1b`: bật Email/Password, thêm domain `l2practice.github.io`, publish Firestore rules.
- Đã tạo các composite indexes; Firebase đang build chúng.

## Cần bạn thực hiện trong Firebase

1. Firebase Console → **Storage** → **Upgrade project** để chuyển Spark sang Blaze nếu muốn tải audio Listening lên Firebase Storage. Firebase hiện khóa Storage ở Spark. Việc chuyển gói có thể phát sinh chi phí và cần phương thức thanh toán; tôi chưa đổi gói.
2. Khi Storage được bật, tạo bucket, vào **Storage → Rules**, dán `storage.rules` và Publish.
3. Chờ các index trong Firestore hiện trạng thái **Enabled**.

## Cần hoàn tất backend Apps Script trước khi mở đăng ký/chấm bài

Phần web tĩnh hiện chạy, nhưng các action đăng ký/quên mật khẩu và chấm IELTS phụ thuộc Apps Script. Tôi chưa deploy Apps Script vì Apps Script mới tạo chưa được nạp mã đúng, và không muốn thay đổi deployment đang dùng bởi app VocabMaster hiện có. Cần chủ sở hữu Google xác nhận Apps Script project cần dùng rồi:

1. Mở Apps Script project đó, thêm nội dung `gas/FirebaseVM.gs`; đảm bảo `gas/Code.gs` có router `fbRoute` và `vmfbIeltsGradeAttempt` được gọi cho request chấm IELTS.
2. Cấp OAuth scopes theo `gas/appsscript.json`, chạy kiểm tra kết nối và cấp quyền.
3. Deploy **Web app** với quyền truy cập phù hợp; cập nhật URL `/exec` mới trong `vm-common.js` thay cho URL cũ.
4. Commit `vm-common.js` lên GitHub để Pages dùng backend mới.

Không tạo tài khoản giáo viên hay dữ liệu mẫu trong Firebase. Sau khi backend sẵn sàng, đăng ký tài khoản GV rồi tạo lớp trước khi SV đăng ký; Firestore hiện chưa có dữ liệu lớp/đề.

## Cập nhật từ gói này

Chỉ thay các file cùng tên trong repo. Thêm `ielts.html`, `firestore.indexes.json`, `storage.rules` và thư mục `tests/`. Giữ nguyên `index.html`, `login.html`, `signup.html`, `vm-theme.css`, `vm-cefr.js`, `cefr-dict.js` cùng các file khác của repo.

Firebase Web API key trong `vm-common.js` là public client config; không commit service account key, Firebase Admin key hoặc mật khẩu.
