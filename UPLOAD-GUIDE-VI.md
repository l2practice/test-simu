# VocabMaster IELTS — trạng thái triển khai và hướng dẫn

Trang web đã được đưa lên GitHub Pages: https://l2practice.github.io/test-simu/ . Mã nguồn nằm tại https://github.com/l2practice/test-simu . Đề ở trạng thái **Chờ kiểm tra** chỉ GV phụ trách xem trong hàng chờ; chỉ sau khi GV duyệt/publish đề mới xuất hiện trong Library cho cả lớp.

## Đã triển khai

- Repo `l2practice/test-simu` trên nhánh `main`; GitHub Pages đang phục vụ trang tại link ở trên.
- Firebase project riêng `test-simulation-4dc1b`: Firestore rules đã Publish; Email/Password bật; domain `l2practice.github.io` đã thêm; ba composite indexes đều **Enabled**.
- Apps Script tại link bạn gửi đã được cập nhật lên **Version 2**, giữ nguyên `/exec` URL và quyền hiện có. Code gồm router IELTS import/chấm điểm và Firebase auth helpers.
- Đã chạy `vmfb_0_TestConnection`: Firestore admin, Firebase Auth admin, Google Sheet và Mail đều **OK**.

## Bắt đầu dùng

1. Mở [trang Test Simu](https://l2practice.github.io/test-simu/).
2. Tạo tài khoản giáo viên trên trang đăng ký / nút đăng nhập giáo viên.
3. Đăng nhập GV, tạo lớp; sau đó SV đăng ký với mã lớp.
4. Khi tạo đề, nhập từng Passage/Part ở cột nội dung, câu hỏi ở cột kế bên và đáp án ở cuối form. Listening có thêm trường script riêng cho từng Part (script chỉ mở sau khi SV nộp bài).
5. SV có thể lưu bản nháp riêng; nút **Finish & contribute** gửi đề cho GV. GV kiểm tra trong Library và publish trước khi SV khác nhìn thấy.

Firestore hiện chưa có dữ liệu lớp, tài khoản GV/SV hoặc đề. API key Gemini/Groq được SV nhập ở AI settings và chỉ lưu trong localStorage trên trình duyệt đó. Sau khi nộp bài, app tự gọi provider để nhận xét; nếu chưa có key thì app hướng dẫn nhập. Firebase rules cần được cập nhật cùng mã nguồn để luồng đóng góp hoạt động.

## Audio Listening (tùy chọn)

Firebase Console hiện báo Storage cần nâng cấp từ Spark lên Blaze. Nếu bạn muốn cho phép tải audio lên Firebase Storage, chủ dự án cần nâng cấp gói, tạo bucket rồi Publish `storage.rules`. Mình chưa thay đổi gói thanh toán. Phần Reading và các chức năng IELTS khác không cần bật Storage.

## Cập nhật mã bằng gói ZIP

Gói chỉ chứa các file đã thêm/sửa. Thay các file cùng tên trong repo, thêm `ielts.html`, `firestore.indexes.json`, `storage.rules` và thư mục `tests/`. Giữ các file cũ như `index.html`, `login.html`, `signup.html`, `vm-theme.css`, `vm-cefr.js`, `cefr-dict.js`.

Firebase Web API key trong `vm-common.js` là client config công khai. Không commit service account key, Firebase Admin key hoặc mật khẩu.

## Gói cập nhật form đề và AI feedback

Sau khi tải mã mới, publish lại `firestore.rules` và `storage.rules` trong Firebase Console. GitHub Pages cần cập nhật các file `ielts.html`, `vm-fbdata.js`, `vm-common.js`, `firestore.rules`, `storage.rules`, `tests/ielts-model.test.js` và hướng dẫn này. API key AI không cần cấu hình trên Firebase hoặc Apps Script.

## Bản cập nhật: màn chia đôi, đăng nhập trước, sidebar

- **Đăng nhập trước.** Trang chủ chỉ còn Sign in / Sign up. Sau khi đăng nhập, sinh viên vào IELTS Practice mới thấy lựa chọn **Reading / Listening**.
- **Làm bài theo tab Passage 1–3 (Reading) hoặc Part 1–4 (Listening).** Bên trái là bài đọc, bên phải là câu hỏi của đúng phần đó. Listening có thêm cột **Script** (khoá đến khi nộp bài) và thanh audio cố định phía trên. Đáp án nằm cuối trang, chỉ mở sau khi nộp.
- **Phân tích khi làm bài.** Hệ thống ghi thời gian từng câu/từng phần, số lần đổi đáp án, câu bỏ trống, số lần rời tab. Khi nộp bài, trang hiện phân tích cục bộ; nếu đã nhập key Gemini/Groq trong AI settings thì AI viết nhận xét tiếng Việt cho từng câu sai.
- **Form tạo đề (giáo viên và sinh viên đóng góp).** Tab cho từng Passage/Part: nội dung bên trái, câu hỏi bên phải (Listening thêm cột Script), **đáp án ở cuối, mỗi câu một ô** nên không lệch thứ tự.
- **Giao diện đồng bộ với Vocab-master.** Dùng đúng `vm-theme.css` của repo `l2practice/vocab-master` (bố cục thanh icon nổi, panel trắng bo tròn, font Be Vietnam Pro) với bảng màu xanh dương và cam nhạt theo ảnh mẫu của bạn, thanh icon nổi bên trái đủ 8 tab cho cả giáo viên và sinh viên, kể cả trang IELTS. Trên điện thoại thanh này ẩn, mở bằng nút ☰. Trang chủ, favicon, màu biểu đồ cũng đổi theo bảng màu này.
- **Script không còn nằm trong tài liệu đề mà sinh viên đọc được.** Nó được lưu cùng kho đáp án, chỉ trả về sau khi nộp bài.

### Việc cần làm khi cập nhật
1. Thay các file: `index.html`, `login.html`, `ielts.html`, `student.html`, `teacher.html`, `vm-common.js`, `vm-fbdata.js`, `vm-theme.css`, `favicon.svg`.
2. Apps Script: dán lại `gas/FirebaseVM.gs`, rồi **Deploy ▸ Manage deployments ▸ Edit ▸ New version**. Bước này cần để sinh viên nhận đáp án đúng và script sau khi nộp.
3. Đề Listening đã lưu trước bản này có thể còn script trong tài liệu đề; mở **Edit** rồi **Lưu** lại để chuyển script vào kho đáp án.
