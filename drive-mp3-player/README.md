# Drive MP3 Player (Chrome Extension, Manifest V3)

Nghe file MP3 từ Google Drive ngay trong Chrome: phát nền, tua ±5s, tự cache để nghe offline, xóa cache bất kỳ lúc nào.

## Cấu trúc thư mục

```
drive-mp3-player/
├── manifest.json        # Khai báo extension + OAuth client_id
├── background.js        # Service worker: tạo offscreen document, cấp token Google
├── offscreen.html       # Trang ẩn chứa thẻ <audio> (giúp nhạc chạy nền)
├── offscreen.js         # Logic phát nhạc, tải + cache file, Media Session
├── popup.html           # Giao diện popup (trình phát, danh sách, cài đặt)
├── popup.css
├── popup.js             # Logic giao diện: đăng nhập, danh sách, tìm kiếm, upload, điều khiển
├── lib/
│   ├── db.js            # Cache MP3 + cài đặt bằng IndexedDB
│   ├── cleanup.js       # Tự xóa file cũ / vượt dung lượng
│   ├── drive.js         # Gọi Google Drive API (list, download, upload)
│   └── util.js          # Định dạng thời gian / dung lượng / ngày
└── icons/               # icon16.png, icon48.png, icon128.png
```

## Cách hoạt động (ngắn gọn)

- **Phát nền:** `<audio>` nằm trong *offscreen document* (lý do `AUDIO_PLAYBACK`), không nằm trong popup, nên đóng popup nhạc vẫn chạy. Mở lại popup sẽ hỏi offscreen trạng thái hiện tại (bài, vị trí, đang phát/dừng) để hiển thị đúng.
- **Cache (tùy chọn, mặc định TẮT):** công tắc "Lưu file để nghe offline" trong ⚙ Cài đặt. Khi tắt, file Drive chỉ được tải tạm vào RAM để phát, không ghi gì xuống ổ đĩa. Khi bật, lần đầu bấm phát file được tải toàn bộ, lưu vào IndexedDB rồi phát, lần sau phát thẳng từ máy. Tab "Đã lưu offline" hoạt động cả khi không có mạng và không cần đăng nhập.
- **Tự dọn dẹp:** file không nghe quá **90 ngày** (tính từ lần phát cuối) sẽ tự bị xóa, và tổng dung lượng cache được giữ dưới **500 MB** (xóa file nghe lâu nhất trước). Cả hai chỉnh được ở ⚙ Cài đặt. File tải từ máy tính và bài nghe gần nhất không bao giờ bị tự xóa. Việc dọn chạy khi mở popup, sau mỗi lần tải file mới và mỗi ngày một lần ở nền.
- **Xóa cache:** nút 🗑 ở từng file hoặc "Xóa tất cả" ở cuối danh sách. File trên Drive không bị ảnh hưởng.
- **Hàng đợi:** hàng đợi chính là danh sách đang mở (Tất cả hoặc Đã lưu Offline, sau khi lọc tìm kiếm). Hết bài tự chuyển sang bài kế tiếp.
- **3 màn hình theo mockup:** Đăng nhập, Online (tab *Tất cả* / *Đã lưu Offline*, nhãn ✓ và ☁), Offline (banner cam, chỉ hiện file đã lưu). Nút ⚙ mở cài đặt (dung lượng, xóa tất cả, tùy chọn upload lên Drive).
- **Dạng sóng (thanh tua):** khi mở bài, extension giải mã file ở nền (8 kHz, nhẹ) và vẽ dạng sóng của cả file. Chỗ có giọng nói là các thanh cao, chỗ im lặng là thanh phẳng, nên nhìn trước được khi nào audio nói. Dưới sóng có thước thời gian (0s, 10s, 20s… hoặc 1:00, 2:00… tùy độ dài bài), rê chuột lên sóng để xem chính xác giây đó. Phần đã phát sáng màu; bấm hoặc kéo trên sóng để tua. Kết quả được lưu cùng file cache nên lần sau hiện ngay. File lớn hơn 80 MB sẽ bỏ qua dạng sóng.
- **Tốc độ phát:** nút `1x` trên thanh phát mở menu 0.25x → 2x (giống YouTube), giữ nguyên cao độ giọng, nhớ lựa chọn. Phím tắt `Shift + >` / `Shift + <`.
- **Chọn nhiều file:** nút ☰ cạnh ô tìm kiếm bật chế độ chọn (hộp ✓ ở mỗi file, có "Chọn tất cả"). Bấm **▶ Phát** để nghe liên tục theo thứ tự trong danh sách, dùng được cho cả file Drive lẫn file đã lưu.
- **Upload nhiều file:** nút ⬆ cho chọn nhiều MP3 cùng lúc. File được thêm vào cuối tab *Saved offline* và **không tự phát**; bạn kéo biểu tượng ⋮⋮ để sắp xếp thứ tự, rồi bấm vào một file để bắt đầu, các file sau tự phát nối tiếp theo thứ tự đó.
- **Giao diện tiếng Anh:** toàn bộ chữ trong extension đã chuyển sang tiếng Anh. Mỗi file chỉ chiếm một hàng: tên, thời lượng • dung lượng, nhãn `local` (file tải từ máy tính) và biểu tượng máy tính xanh (đã lưu trên máy, nghe được offline).
- **Cửa sổ nổi + thu nhỏ:** nút ⧉ trên thanh tiêu đề mở extension thành cửa sổ riêng, không tự đóng khi bạn bấm sang tab/ứng dụng khác. Trong cửa sổ đó, nút ▬ thu nhỏ còn mỗi thanh phát, bấm lại để mở rộng.
- **Upload:** chọn file MP3 từ máy → lưu vào bộ nhớ extension và phát. Tick "Đồng thời lưu bản sao lên Google Drive" nếu muốn upload thêm lên Drive (giữ popup mở đến khi xong).
- **Lưu ý:** Chrome đóng offscreen document sau ~30 giây không phát âm thanh. Vị trí nghe được lưu lại, nên bấm Play lại sẽ tiếp tục đúng chỗ cũ.

## Bước 1: Cài extension vào Chrome hoặc Edge (để lấy Extension ID)

1. Mở `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục `drive-mp3-player`.
4. Copy **ID** của extension (chuỗi 32 ký tự) hiện dưới tên extension. Extension báo lỗi OAuth là bình thường cho đến khi xong Bước 2.

> ID phụ thuộc đường dẫn thư mục. Đừng đổi tên/di chuyển thư mục sau khi cấu hình, nếu không ID đổi và phải tạo lại OAuth client (hoặc thêm trường `key` vào manifest để cố định ID).

## Bước 2: Cấu hình Google Cloud (kết nối Drive)

1. Vào https://console.cloud.google.com → tạo **project mới** (ví dụ `drive-mp3-player`).
2. **APIs & Services → Library** → tìm **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (hoặc *Google Auth Platform*):
   - User type: **External**.
   - Điền App name, User support email, Developer contact email.
   - **Scopes → Add or remove scopes**, thêm:
     - `https://www.googleapis.com/auth/drive.readonly` (xem danh sách + tải file)
     - `https://www.googleapis.com/auth/drive.file` (chỉ để upload file lên Drive)
   - **Test users → Add users**: thêm chính email Google bạn sẽ dùng để đăng nhập.
   - Để ở trạng thái **Testing** là đủ cho dùng cá nhân.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (KHÔNG chọn "Chrome extension": loại đó chỉ chạy trên Chrome, không chạy trên Edge).
   - Name: tùy ý.
   - **Authorized redirect URIs → Add URI**: `https://<Extension ID>.chromiumapp.org/`
     (thay `<Extension ID>` bằng ID ở Bước 1; hoặc mở popup → ⚙ Cài đặt → "Kết nối Google Drive" → **Sao chép** để lấy đúng URI).
   - Bấm Create, copy **Client ID** (dạng `xxxx.apps.googleusercontent.com`). Không cần Client secret.
5. Mở `manifest.json`, thay `YOUR_CLIENT_ID.apps.googleusercontent.com` bằng Client ID vừa copy.
6. Về `chrome://extensions` → bấm biểu tượng **Reload** của extension.

## Bước 3: Dùng thử

1. Ghim extension lên thanh công cụ (biểu tượng puzzle → ghim), bấm vào icon.
2. Bấm **Đăng nhập Google** → chọn tài khoản (nằm trong Test users). Nếu thấy "Google hasn't verified this app" → **Advanced → Go to ... (unsafe)** → cho phép.
3. Danh sách MP3 trong Drive hiện ra. Gõ vào ô tìm kiếm để lọc theo tên.
4. Bấm một file để phát. Lần đầu sẽ có % tải; sau đó file có nhãn **✓ Offline**.
5. Đóng popup hoặc chuyển tab: nhạc vẫn chạy. Mở lại popup: đúng bài và đúng vị trí.
6. Thử offline: tắt Wi-Fi → mở popup → tab **Đã lưu offline** → phát bình thường.
7. Xóa bớt: bấm 🗑 cạnh file, hoặc "Xóa tất cả" ở cuối danh sách.

Phím tắt trong popup: `Space` phát/dừng, `←` lùi 5s, `→` tới 5s. Phím media của bàn phím/tai nghe cũng hoạt động.

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `redirect_uri_mismatch` | Redirect URI trong OAuth client không khớp. Mở ⚙ Cài đặt trong popup, bấm Sao chép, dán lại vào Authorized redirect URIs (nếu bạn đổi tên/di chuyển thư mục thì Extension ID đổi, phải cập nhật lại). |
| `Chưa cấu hình Client ID` | Chưa thay `YOUR_CLIENT_ID...` trong `manifest.json`, hoặc chưa Reload extension. |
| `This API is not supported on Microsoft Edge` | Bạn đang chạy bản cũ dùng `getAuthToken`. Bản này đã đổi sang `launchWebAuthFlow` nên chạy được trên Edge. |
| `Access blocked: app has not completed verification` | Chưa thêm email vào **Test users** ở OAuth consent screen. |
| Đăng nhập được nhưng danh sách trống | Drive chưa có file `.mp3` (hoặc mimeType `audio/mpeg`). Thử nút Upload. |
| Sau ~7 ngày phải đăng nhập lại | Hành vi của app ở trạng thái Testing; bấm Đăng nhập lại là xong. |
| Phát được một lúc rồi báo lỗi đăng nhập | Token Google chỉ sống ~1 giờ; extension tự xin lại âm thầm. Nếu trình duyệt đã đăng xuất Google thì bấm Đăng nhập lại. |
| Bấm Play offline báo lỗi | File đó chưa từng được phát khi còn mạng nên chưa có trong cache. |
