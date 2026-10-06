# Hướng dẫn đưa IELTS Reading / Listening lên VocabMaster

Gói này bổ sung thư viện đề IELTS Reading/Listening, luyện bài, bài nghe, báo lỗi cho giáo viên, chấm điểm và xem kết quả. Đề ở trạng thái **Chờ kiểm tra** vẫn hiện trong Library và sinh viên được làm; sinh viên có thể báo câu sai để GV chỉnh.

## 1. File có trong gói

- Các file ở thư mục gốc: `ielts.html`, `student.html`, `teacher.html`, `vm-common.js`, `vm-fbdata.js`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`.
- Thư mục `gas/`: `Code.gs`, `FirebaseVM.gs`, `appsscript.json`.
- `tests/ielts-model.test.js`: kiểm tra logic cơ bản; không cần upload lên web.

Giữ nguyên các file hiện có khác trong repo (như `login.html`, `index.html`, `vm-theme.css`, `vm-cefr.js`, `cefr-dict.js`). Không xóa file cũ.

## 2. Cập nhật GitHub Pages

1. Mở repo `l2practice/vocab-master` trên GitHub, vào thư mục gốc.
2. Chọn **Add file → Upload files**.
3. Kéo các file ở thư mục gốc của gói vào trang upload. Giữ đúng tên và vị trí; GitHub sẽ thay file cũ cùng tên và thêm `ielts.html`, `firestore.indexes.json`, `storage.rules`.
4. Tạo thư mục `gas` nếu chưa có và thay `Code.gs`, `FirebaseVM.gs`, `appsscript.json` ở đó chỉ để tiện tham khảo. **Không** tải file `.gs` lên root web app.
5. Tạo commit lên nhánh `main`. Đợi GitHub Pages cập nhật, thường vài phút.

## 3. Firebase: Rules, indexes và Storage

Dùng Firebase project `test-simulation-4dc1b` đã cung cấp. Trước khi bật cho người dùng, đăng nhập Firebase Console đúng tài khoản có quyền quản trị dự án.

1. **Firestore Database → Rules**: thay rules bằng `firestore.rules`, bấm **Publish**.
2. **Firestore Database → Indexes**: tạo các composite index theo `firestore.indexes.json` (có thể dùng Firebase CLI với `firebase deploy --only firestore:indexes`; hoặc tạo index theo từng thông báo lỗi ở Console).
3. **Storage → Get started** nếu chưa khởi tạo bucket.
4. **Storage → Rules**: thay bằng `storage.rules`, bấm **Publish**.
5. Trong **Authentication → Settings → Authorized domains**, cần có `l2practice.github.io`.
6. Kiểm tra **Authentication → Sign-in method → Email/Password** đang bật.

Đừng đưa Firebase Admin key, service account JSON hay mật khẩu vào GitHub. Firebase Web config/API key trong trình duyệt là định danh công khai; bảo mật dựa trên Rules và hạn chế API key phù hợp.

## 4. Apps Script: chấm điểm và nhập URL

1. Mở Apps Script project đang phục vụ VocabMaster.
2. Thay nội dung `Code.gs` bằng `gas/Code.gs`; thêm hoặc thay file `FirebaseVM.gs` bằng `gas/FirebaseVM.gs`.
3. Trong **Project Settings**, bật hiển thị manifest nếu cần; cập nhật scopes trong `appsscript.json` và chấp thuận quyền khi Google yêu cầu.
4. Kiểm tra đầu `FirebaseVM.gs`: `PROJECT_ID` và `API_KEY` phải thuộc `test-simulation-4dc1b` (đã điền theo config bạn gửi).
5. Chạy hàm `vmfb_0_TestConnection` trong Apps Script và chấp thuận quyền. Nếu lỗi quyền, Google account chạy script cần quyền truy cập Firestore của Firebase project.
6. **Deploy → Manage deployments → Edit → New version → Deploy**. Giữ quyền truy cập giống deployment hiện tại; app dùng URL Apps Script đang có trong `vm-common.js`.

Importer chỉ nhận HTTPS từ `ieltstrainingonline.com`, tạo nháp cần GV kiểm tra và không tải audio/video từ trang nguồn. Audio Listening được GV/SV tự tải lên theo quyền trong Storage Rules.

## 5. Thử nghiệm sau khi cập nhật

1. Vào app bằng tài khoản GV, mở mục IELTS Library và tạo đề Reading hoặc Listening.
2. Thử lưu ở trạng thái **Chờ kiểm tra**; đăng nhập tài khoản SV trong lớp được cấp quyền, kiểm tra đề xuất hiện và làm thử.
3. Báo một câu sai từ màn hình bài làm; quay lại tài khoản GV, kiểm tra mục báo cáo, sửa câu rồi lưu/publish.
4. Nộp một bài có đáp án; xem kết quả ở trang Results. Câu chưa có key sẽ không bị tính sai, bài sẽ thể hiện số câu đã chấm.
5. Nếu dùng Listening, upload file audio trong trình sửa đề và thử phát bằng tài khoản SV.

## Lưu ý quan trọng

- `vm-common.js` hiện đã trỏ tới Firebase project `test-simulation-4dc1b` và bật Firebase. Tài khoản/người dùng/dữ liệu của Firebase project cũ không tự chuyển sang project này. Xác nhận đúng project trước khi phát hành; nếu muốn dùng dữ liệu cũ thì cần chạy quy trình chuyển dữ liệu riêng trong `gas/FIREBASE_SETUP.md`.
- Việc upload lên GitHub và deploy Firebase/Apps Script cần thao tác bằng tài khoản của bạn; gói này chưa được publish/deploy.
- Kiểm tra cú pháp JavaScript, inline scripts, JSON, test parser và `git diff --check` đã chạy qua. Chưa có xác minh trên Firebase live project, Apps Script deployment, hoặc thiết bị người dùng.
