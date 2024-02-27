import { parse as htmlParse } from 'node-html-parser';
import fs from 'fs/promises';
import Decimal from 'decimal.js';

const textEleSearch = (() => {

    function regexTester(tester, ele, options) {
        return tester.test(ele[options.key]);
    }
    function stringTester(tester, ele, options) {
        if (ele[options.key] === undefined || ele[options.key] === null) { return false; }
        return ele[options.key].includes(tester);
    }
    function arrayTester(tester, ele, options, shouldCheckChildren) {
        // console.log(`inside the testing function ${Array.isArray(tester)?tester[0]:tester}`);

        let result = false;

        // try all testers until we find a match; when match return true
        for (let i = 0; i < tester.length; i++) {
            const cur_result = shouldCheckChildren(tester[i], ele);
            if (cur_result === true) {
                result = cur_result;
                return result; // break out of loop; we know we've matched
            }
        }

        return result;
    }

    function shouldCheckChildren(tester, ele, options = {}) {


        options = { key: "innerHTML", ...options };
        let { testFunct } = options;

        if (ele === null) { debugger }

        if (testFunct === undefined) {
            if (tester instanceof RegExp) {
                testFunct = regexTester;
            } else if (typeof tester === 'string') {
                testFunct = stringTester;
            } else if (Array.isArray(tester)) {
                testFunct = arrayTester;
            }
        }

        

        if (testFunct === undefined) {
            console.error({ tester, ele, options });
            throw new Error("testerFunct not found");
        } else {
            const to_return = testFunct(tester, ele, options, shouldCheckChildren);
            return to_return
        }

    }

    return async function textEleSearch(tester, top_element, options) {

        if (top_element === undefined) { top_element = document.body; } // if no top element, set to this page's body

        let to_return;
        let filtered_descendants;

        // TODO move this elsewhere
        async function filterChildren(children=[]) {
            // frameset -> go deeper on all children
            const child_arr = [...children]; // children isn't actually an array with all the functions

            const child_arr_deep_results = await Promise.all(child_arr.map(async (cur, i, arr) => {
                return await textEleSearch(tester, cur, options);
            }));

            return child_arr_deep_results.filter((cur, i, arr) => {
                return cur !== undefined;
            });
        }

        if (top_element.tagName === "FRAMESET") {
            filtered_descendants = await filterChildren(top_element.children);
            filtered_descendants = filtered_descendants.length === 0 ? undefined : filtered_descendants;
            filtered_descendants = filtered_descendants?.length === 1 ? filtered_descendants[0] : filtered_descendants;
        }
        else if (top_element.tagName === "FRAME" && top_element.contentDocument) {
            await waitOnFrameToLoad(top_element);

            const ele = top_element.contentDocument.querySelector('body');

            if (shouldCheckChildren(tester, ele, options)) {
                filtered_descendants = await filterChildren(ele.children);
                filtered_descendants = filtered_descendants.length === 0 ? undefined : filtered_descendants;
                filtered_descendants = filtered_descendants?.length === 1 ? filtered_descendants[0] : filtered_descendants;
            }
        }
        else if (top_element.childNodes.length < 1) { // no children, check if pass and return element if it does
            if (shouldCheckChildren(tester, top_element, options)) {
                filtered_descendants = top_element;
            }
        }
        else {

            // neither -> check normal body
            const check_children = shouldCheckChildren(tester, top_element, options);
            if ( check_children===true ) {
                // process.exit();
                filtered_descendants = await filterChildren(top_element.childNodes);
                if (filtered_descendants.length === 0) {
                    filtered_descendants = [top_element] // if children don't match, set to self // make an array so the next line couple of lines work out
                }
                filtered_descendants = filtered_descendants.length === 0 ? undefined : filtered_descendants;
                filtered_descendants = filtered_descendants?.length === 1 ? filtered_descendants[0] : filtered_descendants;
            }
        }

        return filtered_descendants;
    }

    async function waitOnFrameToLoad(frame) {
        while ((frame.contentWindow.document).readyState !== "complete") {
            await timeoutPromise(1000);
            console.log('waiting on frame to load readyState->' + (frame.contentDocument || frame.contentWindow.document).readyState);
        }
    }

})();

async function waitOnElement(element_text, loop_time = 250) {

    if (timeoutPromise === undefined) {
        throw new Error("timeoutPromise is not defined; make sure to include it in the top level user script to use waitOnElement");
    }

    let select_a_date_button = await textEleSearch(element_text);
    while (select_a_date_button === undefined) {
        await timeoutPromise(loop_time);
        select_a_date_button = await textEleSearch(element_text);
    }
    return select_a_date_button;
}

async function getUsage(document) {

    const fixed_rate_text = await getSpecialLine(document);

    const new_top = fixed_rate_text.parentNode.parentNode.parentNode.parentNode.parentNode.nextElementSibling;
    // console.log(energy_usage.length);
    // console.log(new_top.innerHTML);
    let to_return=new_top.innerText
    to_return = to_return.split(',').join('')
    to_return = parseFloat(to_return)
    return to_return;
}

async function getErcotRate(document) {
    const svg_ele = document.querySelector('svg');
    let x = await (textEleSearch('ERCOT', svg_ele).catch((e) => {
        console.error(e);
    }));
    x = x[0]
    let text = x.innerHTML;
    text = text.split('$')[1].split(' Per')[0];
    return parseFloat(text);
}

async function getOncorRate(document, energy_usage) {
    const x = await textEleSearch('Oncor Delivery Charges', document.querySelector('svg'));
    const new_search_top = x.parentNode.parentNode.parentNode.parentNode.parentNode.nextElementSibling;
    const x2 = await textEleSearch('\$', new_search_top);
    const price_str = x2.innerHTML.split('$').join("");
    const price = parseFloat(price_str);
    return new Decimal(price).dividedBy(energy_usage).toNumber();
}

async function getOncorPrice(document) {
    const x = await textEleSearch('Oncor Delivery Charges', document.querySelector('svg'));
    const new_search_top = x.parentNode.parentNode.parentNode.parentNode.parentNode.nextElementSibling;
    const x2 = await textEleSearch('\$', new_search_top);
    const price_str = x2.innerHTML.split('$').join("");
    const price = parseFloat(price_str);
    return price;
}

async function getBaseFee(document) {
    const x = await textEleSearch('Base Fee', document.querySelector('svg'));
    const new_search_top = x.parentNode.parentNode.parentNode.parentNode.parentNode.nextElementSibling;
    const x2 = await textEleSearch('\$', new_search_top);
    const price_str = x2.innerHTML.split('$').join("");
    const price = parseFloat(price_str);
    return price;
}

async function getSpecialLine(document ){
    let fixed_rate_text_ele = await (textEleSearch('Fixed Rate', document.querySelector('svg')).catch((e) => {
        console.error(e);
    }));
    return fixed_rate_text_ele;
}

async function getEnergyCharge(document){
    const fixed_rate_text = await getSpecialLine(document);
    const regex = /Base : (.*)\)/;
    return parseFloat(regex.exec(fixed_rate_text.innerHTML)[1])
}

async function getStartTime( document ){
    let date_ele = await (textEleSearch('Bill Period', document.querySelector('svg')).catch((e) => {
        console.error(e);
    }));
    const regex = /- (.*) thru/;
    const date = regex.exec(date_ele.innerHTML)[1]
    return date;
}
async function getEndTime( document ){
    let date_ele = await (textEleSearch('Bill Period', document.querySelector('svg')).catch((e) => {
        console.error(e);
    }));
    const regex = /thru  ?(.*)$/;
    const date = regex.exec(date_ele.innerHTML)[1]
    return date;
}

async function getSingleBillData(file_path){
    let html = (await fs.readFile(file_path)).toString();
    const root = htmlParse(html);

    // console.log(root.innerHTML);
    // console.log(root.innerText);

    const special_line = getSpecialLine(root);
    const energy_usage = await getUsage(root);

    const ercot_rate = await getErcotRate(root);
    const oncor_rate = await getOncorRate(root,energy_usage);
    const oncor_price = await getOncorPrice(root,energy_usage);
    const base_fee = await getBaseFee(root);

    const start = await getStartTime(root);
    const end = await getEndTime(root);
    const energy_charge = await getEnergyCharge(root, special_line);

    return {
        start,
        end,
        energy_usage,
        ercot_rate,
        oncor_rate,
        oncor_price,
        base_fee: base_fee,
        from_bill: true, 
        energy_charge,
    };
}

export async function getBillData(){

    const dir = './bills/svgs';
    const file_list = await fs.readdir(dir);

    const to_return = [];
    // return to_return;// TODO remove 

    for( let i in file_list){
        const bill_data = await getSingleBillData(`${dir}/${file_list[i]}`)
        // console.log(bill_data);
        to_return.push(bill_data);
    }

    return to_return;
}

// (async()=>{
//     const x = await getBillData();
//     console.log(x);
// })();
