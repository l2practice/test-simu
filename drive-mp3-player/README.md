# Drive MP3 Player (Chrome Extension, Manifest V3)

Nghe file MP3 từ Google Drive ngay trong Chrome: phát nền, tua ±5s, tự cache để nghe offline, xóa cache bất kỳ lúc nào.

## Cấu trúc thư mục

```
drive-mp3-player/
├── manifest.json        # Khai báo extension + OAuth client_id
├── background.js        # Service worker: tạo offscreen document, cấp token Google
├── offscreen.html       # Trang ẩn chứa thẻ <audio> (giúp nhạc chạy nền)
├── offscreen.js         # Logic phát nhạc, tải + cache file, Media Session
├── config.js            # CLIENT_ID / CLIENT_SECRET của Google OAuth (bạn tự điền)
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
- **Chọn file để nghe + tự lưu offline:** vào một thư mục Drive, bấm nút ☑ cạnh ô tìm kiếm, bấm vào các file muốn nghe rồi **▶ Play & save**. Chỉ các file đã chọn được phát (theo thứ tự trong danh sách) và được tải về **Saved offline** (tải thêm ở nền trong lúc bài đầu đang phát, thanh phát hiện *Saving for offline n/m*). File tự xóa sau số ngày đặt ở ⚙ Settings (mặc định 90 ngày) hoặc bạn xóa tay bằng 🗑. Bấm trực tiếp một file (không bật ☑) chỉ **nạp** file đó vào trình phát ở trạng thái tạm dừng; âm thanh chỉ chạy khi bạn bấm nút ▶ (hoặc *Play & save*). Hết một bài, trình phát chuyển sang bài kế trong danh sách bạn đã chọn.
- **Duyệt theo thư mục Drive (không tải cả Drive):** tab *Drive* mở ra màn chọn thư mục: dán link thư mục (`https://drive.google.com/drive/folders/...`) rồi bấm Open, hoặc bấm *Browse My Drive*. Trong thư mục hiển thị thư mục con (bấm để vào, nút ← để quay lại) và các file MP3; chỉ lấy danh sách của thư mục đang mở. Nút ☆ để ghim thư mục, ghim xong nó nằm sẵn ở mục *Pinned folders*. Extension nhớ thư mục bạn mở lần cuối. Ô tìm kiếm chỉ tìm trong thư mục đang mở; hàng đợi, chọn nhiều file và upload (vào đúng thư mục đang mở, nếu bật tùy chọn lưu lên Drive) đều theo thư mục đó.
- **Đăng nhập lâu dài:** với `CLIENT_SECRET` trong `config.js`, extension lưu refresh token và tự gia hạn access token (1 giờ) ở nền, bạn không phải đăng nhập lại. Lỗi mạng tạm thời không làm bạn bị đăng xuất. Trạng thái hiện ở ⚙ Settings → Connect Google Drive.
- **Thời gian từng file:** file mới thêm được đo thời lượng ngay; file cũ chưa có sẽ được đo ở nền khi mở popup. Dòng tóm tắt phía trên danh sách hiển thị *số file • Total • Remaining* của hàng đợi. Ở thanh phát có thêm thời gian còn lại của bài đang nghe. Nút ✕ góc phải thanh phát để đóng trình phát.
- **Volume boost (tăng âm lượng vượt 100%):** nút 🔊 ở góc trái thanh phát. **Auto** (mặc định): khi mở file, extension đo độ lớn phần có tiếng (bỏ qua quãng im) và tự tăng đến mức nghe rõ, tối đa ×8. Muốn tự chọn thì dùng 150%, 200%, 300%, 400%; **Off** là âm lượng gốc. Có bộ giới hạn chống vỡ tiếng khi tăng mạnh. Số đo của từng file được lưu cùng file nên lần sau áp dụng ngay. Lưu ý: nút âm lượng của máy/loa vẫn là mức tối đa bên ngoài, boost chỉ cộng thêm bên trong. Tăng quá lớn với file thu rất nhỏ có thể làm to cả tiếng ồn nền.
- **Auto-play next file:** công tắc trong ⚙ Settings → Playback (mặc định bật). Bật: hết một file thì tự phát file kế trong danh sách đã chọn. Tắt: dừng sau mỗi file, bạn bấm ▶ cho file tiếp theo.
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
   - **Data Access → Add or remove scopes** (menu bên trái của Google Auth Platform), thêm 2 scope. Nếu không thấy trong bảng, cuộn xuống ô **Manually add scopes**, dán từng dòng rồi bấm **Add to table → Update → Save**:
     - `https://www.googleapis.com/auth/drive.readonly` (xem danh sách + tải file)
     - `https://www.googleapis.com/auth/drive.file` (chỉ để upload file lên Drive)
   - Không thấy scope Drive nào trong bảng thường là do chưa **Enable Google Drive API** (bước 2). Với dùng cá nhân, bước khai báo scope không bắt buộc: extension tự xin 2 quyền này khi bạn đăng nhập.
   - **Audience → Test users → Add users**: thêm chính email Google bạn sẽ dùng để đăng nhập.
   - **Quan trọng để không phải đăng nhập lại mỗi 7 ngày:** ở trạng thái *Testing*, Google tự hủy refresh token sau 7 ngày. Hãy vào OAuth consent screen → **Publish app** (chuyển sang *In production*). Với dùng cá nhân bạn không cần gửi Google xác minh; chỉ sẽ thấy màn cảnh báo "Google hasn't verified this app" khi đăng nhập lần đầu (Advanced → Go to ...).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (KHÔNG chọn "Chrome extension": loại đó chỉ chạy trên Chrome, không chạy trên Edge).
   - Name: tùy ý.
   - **Authorized redirect URIs → Add URI**: `https://<Extension ID>.chromiumapp.org/`
     (thay `<Extension ID>` bằng ID ở Bước 1; hoặc mở popup → ⚙ Cài đặt → "Kết nối Google Drive" → **Sao chép** để lấy đúng URI).
   - Bấm Create, copy **Client ID** (dạng `xxxx.apps.googleusercontent.com`) và **Client secret** (nên copy cả hai; secret giúp bạn không phải đăng nhập lại, xem bên dưới).
5. Mở file **`config.js`** (không còn dùng `manifest.json`), điền `CLIENT_ID` và `CLIENT_SECRET`.
   - Có `CLIENT_SECRET`: extension dùng **refresh token**, đăng nhập một lần là giữ lâu dài, tự gia hạn token 1 giờ ở nền.
   - Để trống `CLIENT_SECRET`: mỗi token chỉ sống ~1 giờ và gia hạn âm thầm nhờ phiên Google của trình duyệt; nếu phiên đó mất thì phải đăng nhập lại.
   - File này chỉ nằm trên máy bạn, đừng chia sẻ hay đưa lên GitHub khi đã điền secret.
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

## Chuyển sang máy khác

`manifest.json` đã có trường `key` nên **Extension ID luôn là `gofimhhhodpjkckaacplfcpinajcoepi` trên mọi máy và mọi trình duyệt (Chrome/Edge)**. Vì vậy Redirect URI trên Google Cloud không đổi:

`https://gofimhhhodpjkckaacplfcpinajcoepi.chromiumapp.org/`

Trên máy mới:
1. Copy cả thư mục `drive-mp3-player` (nhớ kèm `config.js` đã điền Client ID/secret) sang máy mới.
2. `chrome://extensions` hoặc `edge://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục.
3. Mở popup → **Sign in with Google** → chọn tài khoản, cho phép. Xong, không cần đụng vào Google Cloud.

Không chuyển theo: file đã lưu offline và thư mục đã ghim (nằm trong dữ liệu của từng trình duyệt). Trên máy mới bạn ghim lại và phát lại các file cần nghe, chúng sẽ tự tải về.

Lưu ý khi cập nhật từ bản cũ chưa có `key`: ID đổi, bạn phải thêm Redirect URI mới ở trên vào OAuth client một lần, và dữ liệu offline của ID cũ không còn dùng được.

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `redirect_uri_mismatch` | Từ bản có `key` cố định, URI phải là `https://gofimhhhodpjkckaacplfcpinajcoepi.chromiumapp.org/` (thêm vào **Authorized redirect URIs** của OAuth client, không phải JavaScript origins). Nếu vẫn lỗi: Redirect URI trong OAuth client không khớp. Mở ⚙ Cài đặt trong popup, bấm Sao chép, dán lại vào Authorized redirect URIs (nếu bạn đổi tên/di chuyển thư mục thì Extension ID đổi, phải cập nhật lại). |
| `Client ID is not configured` | Chưa điền `CLIENT_ID` trong `config.js`, hoặc chưa Reload extension. |
| `client_secret is missing` / `invalid_client` | `CLIENT_SECRET` trong `config.js` sai hoặc không thuộc cùng OAuth client với `CLIENT_ID`. |
| Bị yêu cầu đăng nhập lại sau ~7 ngày | App đang ở trạng thái *Testing*; chuyển sang *In production* (xem Bước 2). |
| `This API is not supported on Microsoft Edge` | Bạn đang chạy bản cũ dùng `getAuthToken`. Bản này đã đổi sang `launchWebAuthFlow` nên chạy được trên Edge. |
| `Access blocked: app has not completed verification` | Chưa thêm email vào **Test users** ở OAuth consent screen. |
| Đăng nhập được nhưng danh sách trống | Drive chưa có file `.mp3` (hoặc mimeType `audio/mpeg`). Thử nút Upload. |
| Sau ~7 ngày phải đăng nhập lại | Hành vi của app ở trạng thái Testing; bấm Đăng nhập lại là xong. |
| Phát được một lúc rồi báo lỗi đăng nhập | Token Google chỉ sống ~1 giờ; extension tự xin lại âm thầm. Nếu trình duyệt đã đăng xuất Google thì bấm Đăng nhập lại. |
| Bấm Play offline báo lỗi | File đó chưa từng được phát khi còn mạng nên chưa có trong cache. |
