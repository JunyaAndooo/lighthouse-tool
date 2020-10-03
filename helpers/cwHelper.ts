import axios from "axios";
import FormData from "form-data";

/*
 * チャットワークのメッセージです。
 */
export type CwMessage = {
  body: string;
  message_id: string;
  account: {
    account_id: string;
    name: string;
    avatar_image_url: string;
  };
};

/*
 * チャットワークのメッセージを取得します。
 */
export async function getCwMessage<T>(cwKey: string, cwRoomId: string, filter: (data: CwMessage[]) => T): Promise<T | null> {
  const res = await axios
    .get(`https://api.chatwork.com/v2/rooms/${cwRoomId}/messages`, {
      headers: {
        "X-ChatWorkToken": cwKey,
      },
      params: {
        force: 1,
      },
    })
    .catch((err) => {
      return err.response;
    });
  if (res.status !== 200) {
    return null;
  }
  return filter(res.data);
}

/*
 * チャットワークに通知します。
 */
export async function postCw(cwKey: string, cwRoomId: string, text: string, self_unread: boolean = true): Promise<void> {
  const res = await axios
    .post(
      `https://api.chatwork.com/v2/rooms/${cwRoomId}/messages`,
      {},
      {
        headers: {
          "X-ChatWorkToken": cwKey,
        },
        params: {
          body: text,
          self_unread: self_unread ? "1" : "0",
        },
      }
    )
    .catch((err) => {
      return err.response;
    });
  if (res.status !== 200) {
    console.log(res);
  }
}

/*
 * チャットワークにファイル送信します。
 * こんな感じで、ファイルをセットしてください。
 * const data = new FormData();
 * data.append('file', file, file.fileName);
 */
export async function postCwFile(cwKey: string, cwRoomId: string, data: FormData): Promise<void> {
  await axios.post(`https://api.chatwork.com/v2/rooms/${cwRoomId}/files`, data, {
    headers: {
      "X-ChatWorkToken": cwKey,
      accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${data.getBoundary()}`,
    },
  });
}
