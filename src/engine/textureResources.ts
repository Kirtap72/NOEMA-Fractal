/** Bound allocations before asking the browser decoder to allocate a bitmap. */
export function imageHeaderDimensions(data:string):{width:number;height:number}{
 const prefix=data.indexOf(',');if(prefix<0||data.length>8_000_000||!/^data:image\/(png|jpeg);base64,/.test(data))throw Error('The data map must be an embedded PNG/JPEG within 6 MB.');
 const head=atob(data.slice(prefix+1,Math.min(data.length,prefix+1+262144))),b=Uint8Array.from(head,c=>c.charCodeAt(0));
 let width=0,height=0;
 if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b.length>=24){const view=new DataView(b.buffer);width=view.getUint32(16);height=view.getUint32(20);}
 else if(b[0]===255&&b[1]===216){for(let p=2;p+8<b.length;){if(b[p]!==255){p++;continue}const marker=b[p+1]!;if(marker===255){p++;continue}if(marker===0xd9||marker===0xda)break;const length=(b[p+2]!<<8)|b[p+3]!;if([0xc0,0xc1,0xc2].includes(marker)){height=(b[p+5]!<<8)|b[p+6]!;width=(b[p+7]!<<8)|b[p+8]!;break}if(length<2)break;p+=length+2;}}
 if(width<1||height<1||width>8192||height>8192||width*height>16_777_216)throw Error('The header of the picture is invalid or exceeds 8192 px / 16 MP.');return {width,height};
}
