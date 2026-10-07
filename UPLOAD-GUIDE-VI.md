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


## Bản cập nhật lớn: Library chung, In-class, form tạo đề mới

- **Vào app là trang đăng nhập.** `index.html` chuyển thẳng tới đăng nhập. Sinh viên đăng nhập xong vào **IELTS Practice**, chọn Reading hoặc Listening ngay tại đó.
- **Menu gọn.** Sinh viên: IELTS Practice, In-class, History, Settings. Giáo viên: Library, In-class, Results, Classes, Settings. Đã bỏ Homework, ReadWise, Dịch (và Overview, Assignments, HW Book).
- **Library chung.** Mỗi đề là một **Part** của một **Book / Test** (như Listening Dictation: Cam1–Cam30, Test 1–12, Passage 1–3 hoặc Part 1–4). Mọi sinh viên và giáo viên đều thấy Library, nhóm theo Book → Test. Đủ phần thì có nút **Làm full test**.
- **Tạo đề.** Bắt buộc chọn Book, Test, Part. Dán nguyên phần câu hỏi, ứng dụng tự nhận diện dạng câu (Multiple choice, True/False/Not Given, Matching, Completion…); có thể dán bảng đáp án để tự điền. Chỉ có nút **Hoàn tất**: đề vào Library ngay, không còn lưu nháp hay gửi giáo viên duyệt. Mỗi Part chỉ tồn tại một lần trong Library.
- **In-class (giáo viên).** Giao đề từ Library (một Part hoặc full test) cho lớp với giờ bắt đầu và thời lượng; gia hạn cả lớp hoặc từng sinh viên; xem kết quả và danh sách chưa nộp. Muốn thêm đề mới thì thêm vào Library rồi chọn để giao.
- **In-class (sinh viên).** Thấy phiên của lớp, chỉ làm được khi đang mở, đồng hồ đếm ngược, hết giờ tự nộp. Máy chủ cũng từ chối bài nộp quá hạn.
- **Màu.** Nền chuyển từ xanh dương sang cam, banner và nút dùng gradient xanh–cam.

### Việc cần làm khi cập nhật (theo thứ tự)
1. **Firebase Console ▸ Firestore ▸ Rules:** dán `firestore.rules` rồi Publish. (Storage rules chỉ cần khi bật Storage.)
2. **Apps Script:** dán lại `gas/FirebaseVM.gs`, Deploy ▸ Manage deployments ▸ Edit ▸ New version.
3. Thay các file trên GitHub: `index.html`, `ielts.html`, `student.html`, `teacher.html`, `vm-fbdata.js`, `vm-theme.css`, `favicon.svg`, `firestore.rules`, `storage.rules`, `gas/FirebaseVM.gs`.
4. Đề cũ (kiểu nhiều passage trong một đề, hoặc trạng thái nháp/chờ kiểm tra) sẽ không hiện trong Library mới; hãy tạo lại bằng form mới.


## Bản cập nhật: Glance, Task Type, form tạo đề dạng khung, giao diện thi kiểu IELTS (toàn bộ app bằng tiếng Anh)

- **Glance.** Sinh viên: biểu đồ điểm qua các bài với 2 đường (Reading xanh lá, Listening cam), đổi sang bảng, lọc theo skill, bấm chú giải để ẩn/hiện đường, rê chuột vào điểm để xem chi tiết, thêm bảng độ chính xác theo Task Type. Giáo viên: chọn lớp mới xem được; có bảng điểm từng sinh viên, nút View để xem biểu đồ của sinh viên đó, và khung **New Practice** báo ai vừa làm bài hoặc vừa thêm đề mới.
- **Menu.** Sinh viên: Glance, IELTS Practice, In-class, Settings. Giáo viên: Glance, Library, In-class, Results, Classes, Settings.
- **Library theo Task Type.** Tab *By task type* gom câu hỏi cùng dạng từ nhiều Part để luyện riêng một dạng (tối đa 12 Part mỗi lần).
- **Tạo đề.** Mỗi Passage/Part là một hàng khung ngang. Reading: (1) bài đọc, (2) câu hỏi, (3) đáp án; thêm Passage 2, 3 ở các hàng bên dưới. Listening: (1) câu hỏi, (2) audio (file hoặc link, không bắt buộc), (3) đáp án, (4) script (không bắt buộc). Phần Instruction được giữ nguyên và hiển thị khi làm bài; ứng dụng tự phân loại Task Type.
- **Giao diện thi.** Toàn màn hình như IELTS: bài đọc bên trái, câu hỏi bên phải, bôi vàng/xanh/hồng ở cả hai bên, thanh số câu ở dưới, đồng hồ. Listening: nếu đề chưa có audio, sinh viên tự thêm file hoặc link ngay trong lúc làm bài.
- **Tiếng Anh.** Giao diện, thông báo lỗi và email đặt lại mật khẩu đều bằng tiếng Anh.

### Thứ tự cập nhật
1. Firebase Console ▸ Firestore ▸ Rules: dán `firestore.rules`, Publish.
2. Apps Script: dán `gas/FirebaseVM.gs`, Deploy ▸ Manage deployments ▸ Edit ▸ New version.
3. GitHub: thay `index.html`, `login.html`, `signup.html`, `ielts.html`, `student.html`, `teacher.html`, `vm-common.js`, `vm-fbdata.js`, `vm-theme.css`, `gas/FirebaseVM.gs`.


## Bản cập nhật: giao diện Emerald & Amber (xanh lục + cam)
- Bảng màu lấy theo ảnh mẫu và repo Vocab-master: xanh lục đậm `#0F6B4F`, cam `#F08A3C`, nền sage xám nhạt có vòng tròn đào và đá xám, nút và thẻ bóng nổi có vệt phản quang.
- Trang chung dùng xanh lục và cam xen kẽ (Reading xanh, Listening cam). Khi vào làm bài: **Reading toàn xanh lục, Listening toàn cam** (kể cả màn xem kết quả sau khi nộp).
- Các file đổi: `vm-theme.css`, `ielts.html`, `login.html`, `signup.html`, `student.html`, `teacher.html`, `index.html`, `vm-common.js`, `favicon.svg`.


## Bản cập nhật: sinh viên nhập URL, giáo viên duyệt đề trước khi sinh viên làm
- **Nhập từ URL cho cả sinh viên** (chỉ trang ieltstrainingonline.com, tối đa 10 lần/giờ/người). Form luôn có lời nhắc đối chiếu nội dung với bản gốc trước khi bấm Finish; đề nhập từ URL có thêm cảnh báo riêng. Tối đa 4 phần mỗi lần nhập (đủ Listening).
- **Duyệt đề.** Đề do sinh viên tạo ở trạng thái *awaiting check*: hiện trong Library nhưng bị khoá, không làm được, không dùng cho full test, task type hay In-class. Đề do giáo viên tạo hoặc sửa được duyệt ngay. Máy chủ chấm bài cũng từ chối đề chưa duyệt.
- **Thông báo cho giáo viên.** Huy hiệu số trên mục Library; khung *To check* ở đầu Library (nút *Check & approve*: xem bài, câu hỏi, đáp án rồi Approve, Edit hoặc Remove); mục *New Practice* ở Glance có nút Check. Giáo viên của sinh viên đó là người duyệt.
- Sinh viên sửa lại đề đã duyệt thì đề quay về trạng thái chờ kiểm tra.

### Thứ tự cập nhật (lần này cần cả ba)
1. Firestore Rules: dán `firestore.rules`, Publish (thêm kiểm tra trạng thái duyệt).
2. Apps Script: dán **cả hai** `gas/Code.gs` và `gas/FirebaseVM.gs`, rồi Deploy ▸ New version.
3. GitHub: thay `ielts.html`, `vm-fbdata.js`, `vm-common.js`, `vm-theme.css`, `index.html`, `login.html`, `signup.html`, `student.html`, `teacher.html`, `favicon.svg`, `firestore.rules`, `gas/Code.gs`, `gas/FirebaseVM.gs`.


## Bản cập nhật: trình nhập URL đọc đúng cấu trúc trang
- **Cách tách mới (Apps Script).** Đọc theo thẻ HTML của ieltstrainingonline.com thay vì lọc chữ thô: `h3 "READING PASSAGE n" / "PART n"` mở một passage/part; `h3 "Questions a–b"` mở một nhóm câu hỏi (giữ nguyên Instruction, các mục, lựa chọn A–I, danh sách tiêu đề i–viii); `h2 "Answer …"` + `h5 "Passage n"` là bảng đáp án; thẻ `<audio>` cho Listening; ảnh trong bài được giữ lại. Quảng cáo, thanh điều hướng và liên kết bài khác bị loại.
- **Phân loại phía app.** Nhận diện Matching headings/features/information, Multiple choice (kể cả "Choose TWO letters"), True/False/Not given, Yes/No/Not given, Summary/Note/Form/Table completion, điền từ trong đoạn có danh sách lựa chọn. Số câu trùng được đánh lại; đáp án dạng "11&12 B, C", "(animal) movement", "fifty / 50" được hiểu đúng và điền sẵn.
- **Listening.** Mỗi Part nhận link audio gốc (chỉ lưu link, không tải file). Có thể xoá link ở khung Audio nếu muốn dùng file riêng.
- **Xem trước.** Sau khi nhập, form tạo đề chính là màn Preview: sửa passage, câu hỏi, đáp án, loại câu và xoá ảnh thừa rồi mới bấm Finish. Đề của sinh viên vẫn chờ giáo viên duyệt.
- Thứ tự cập nhật: dán `gas/Code.gs` vào Apps Script rồi Deploy ▸ New version; thay `ielts.html` (và các file đã đổi version) trên GitHub. Không cần đổi Firestore Rules.


## Bản cập nhật: sửa lỗi Finish, overlay chờ, Preview, bố cục câu hỏi theo dạng
- **Lỗi Finish.** Firestore không cho mảng nằm trong mảng nên kho đáp án (`ieltsAnswerKeys`) bị từ chối. Đáp án mỗi câu giờ lưu dạng `{a:[…]}`; Apps Script chấm bài đọc được cả định dạng cũ lẫn mới. Dữ liệu cũng được làm sạch giá trị `undefined` trước khi lưu.
- **Overlay chờ** khi nhập URL, khi lưu vào Library và khi mở đề.
- **Preview as student** trong form tạo đề và màn kiểm tra của giáo viên: xem đề đúng như sinh viên sẽ làm, có nút quay lại chỉnh sửa, không nộp được.
- **Bố cục theo dạng câu:** Short answer = bảng (câu hỏi trái, ô trả lời phải); True/False/Not given và Yes/No/Not given = dropdown trong bảng không viền; Matching = câu hỏi bên trái với ô điền, danh sách để ghép (List of Headings/People…) bên phải; Gap-fill (summary/notes/table/form) = ô điền nằm ngay trong đoạn văn; Labelling = hình ở trên, các ô đáp án bên dưới; "Choose TWO letters" = một câu hỏi chung với hai ô chọn.
- Thứ tự cập nhật: dán `gas/FirebaseVM.gs` vào Apps Script rồi Deploy ▸ New version; thay `ielts.html`, `vm-fbdata.js`, `vm-common.js` và các trang đổi số phiên bản trên GitHub. Không cần đổi Firestore Rules.

## Cập nhật: title, nút Save key, ô đáp án, 5 màu highlight, Task Types
Chỉ cần upload lại các file front-end: `ielts.html`, `student.html`, `teacher.html`, `vm-common.js` (không đổi Apps Script/Rules).
- Sửa tên bài trong khung từng Passage/Part khi tạo/sửa đề.
- Key AI (Gemini/Groq) có nút **Save key** ở Settings và ở cửa sổ AI.
- Ô điền đáp án có nền trắng, viền xanh/cam đậm, dễ thấy.
- Highlight có 5 màu: vàng, xanh lá, hồng, xanh dương, cam.
- Menu mới **Task Types**: hiện mọi dạng bài, chọn dạng → chọn Part → luyện chỉ phần câu hỏi thuộc dạng đó.

## Cập nhật: bảng (table), import URL, hộp thoại bo góc
- Dán đề có **bảng**: các dòng có TAB (copy từ web/Word/Excel) hoặc dùng `|` giữa các ô sẽ hiển thị thành bảng thật, ô điền số câu nằm trong bảng. Import URL cũng giữ bảng.
- Import URL: thông báo lỗi rõ nguyên nhân hơn. (Apps Script `Code.gs` có thay đổi nhỏ → dán lại + Deploy phiên bản mới.)
- Thay toàn bộ pop-up của trình duyệt bằng hộp thoại bo góc giữa màn hình (`VM.confirm/VM.prompt`).
