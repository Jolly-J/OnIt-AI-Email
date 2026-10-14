/** Keep the input contract aligned with backend/app/core/mail_recipients.py. */
const mailbox = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function normalizeRecipients(to: string, cc = '', bcc = '') {
  const seen = new Set<string>();
  const groups = [to, cc, bcc].map((value, index) => {
    const label = ['收件人', '抄送', '密送'][index];
    if (/[\r\n]/.test(value)) throw new Error(`${label}地址不能包含换行`);
    const addresses: string[] = [];
    for (const item of value.split(/[,;，；](?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      let address = item.trim();
      if (!address) continue;
      if (/[<>]/.test(address)) {
        const match = /^[^<>@]+<([^<>]+)>$/.exec(address);
        if (!match) throw new Error(`${label}邮箱格式不正确`);
        address = match[1].trim();
      }
      if (!mailbox.test(address)) throw new Error(`${label}邮箱格式不正确，请用逗号或分号分隔邮箱地址`);
      const [local, domain] = address.split('@');
      address = `${local}@${domain.toLowerCase()}`;
      if (!seen.has(address)) {
        seen.add(address);
        addresses.push(address);
      }
    }
    return addresses.join(', ');
  });
  if (!groups[0]) throw new Error('请输入收件人邮箱地址');
  return { to_email: groups[0], cc_email: groups[1], bcc_email: groups[2] };
}
